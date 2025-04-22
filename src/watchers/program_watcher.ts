import { Connection } from "@solana/web3.js";
import type { ProgramAccountState, UpgradeAuthorityInfo } from "../monitor/rpc_poller.js";
import { fetchProgramState, fetchUpgradeAuthority, pollProgram } from "../monitor/rpc_poller.js";
import { diffAuthority, type AuthorityDiffResult } from "../diff/authority_diff.js";
import { SnapshotStore } from "../store/snapshot_store.js";
import { evaluateRules, type Alert } from "../alerts/alert_rules.js";
import { dispatchAlerts, type AlertSink } from "../alerts/alert_sink.js";

export interface WatcherConfig {
  programId: string;
  rpcUrl: string;
  intervalMs: number;
  commitment: "processed" | "confirmed" | "finalized";
  snapshotDir?: string;
}

export interface WatcherEvent {
  type: "state_update" | "authority_change" | "alert";
  programId: string;
  slot: number;
  timestamp: number;
  state?: ProgramAccountState;
  authorityDiff?: AuthorityDiffResult;
  alerts?: Alert[];
}

export type WatcherCallback = (event: WatcherEvent) => void | Promise<void>;

export class ProgramWatcher {
  private connection: Connection;
  private config: WatcherConfig;
  private store: SnapshotStore;
  private abortController: AbortController | null = null;
  private sinks: AlertSink[] = [];

  constructor(config: WatcherConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, config.commitment);
    this.store = new SnapshotStore(config.snapshotDir);
  }

  addSink(sink: AlertSink): void {
    this.sinks.push(sink);
  }

  async fetchCurrent(): Promise<{ state: ProgramAccountState; authority: UpgradeAuthorityInfo }> {
    const [state, authority] = await Promise.all([
      fetchProgramState(this.connection, this.config.programId),
      fetchUpgradeAuthority(this.connection, this.config.programId),
    ]);
    return { state, authority };
  }

  async checkOnce(onEvent?: WatcherCallback): Promise<WatcherEvent[]> {
    const events: WatcherEvent[] = [];
    const { state, authority } = await this.fetchCurrent();
    const previous = this.store.getLatest(this.config.programId);

    this.store.save(this.config.programId, state, authority);

    if (previous) {
      const authDiff = diffAuthority(previous.authority, authority);
      if (authDiff.hasChanges) {
        const event: WatcherEvent = {
          type: "authority_change",
          programId: this.config.programId,
          slot: state.slot,
          timestamp: Date.now(),
          authorityDiff: authDiff,
        };
        events.push(event);
        if (onEvent) await onEvent(event);
      }

      const changes: string[] = [];
      if (previous.state.dataLength !== state.dataLength) {
        changes.push(`data_length: ${previous.state.dataLength} -> ${state.dataLength}`);
      }
      if (previous.state.owner !== state.owner) {
        changes.push(`owner: ${previous.state.owner} -> ${state.owner}`);
      }

      if (changes.length > 0) {
        const alerts = evaluateRules({
          programId: this.config.programId,
          current: state,
          previous: previous.state,
          upgradeInfo: authority,
          changes,
        });

        if (alerts.length > 0) {
          await dispatchAlerts(alerts, this.sinks);
          const event: WatcherEvent = {
            type: "alert",
            programId: this.config.programId,
            slot: state.slot,
            timestamp: Date.now(),
            state,
            alerts,
          };
          events.push(event);
          if (onEvent) await onEvent(event);
        }

        const updateEvent: WatcherEvent = {
          type: "state_update",
          programId: this.config.programId,
          slot: state.slot,
          timestamp: Date.now(),
          state,
        };
        events.push(updateEvent);
        if (onEvent) await onEvent(updateEvent);
      }
    }

    return events;
  }

  async start(onEvent?: WatcherCallback): Promise<void> {
    this.abortController = new AbortController();
    let previousState: ProgramAccountState | null = null;

    await pollProgram(
      this.connection,
      this.config.programId,
      async (current, changes) => {
        const authority = await fetchUpgradeAuthority(this.connection, this.config.programId);
        this.store.save(this.config.programId, current, authority);

        const alerts = evaluateRules({
          programId: this.config.programId,
          current,
          previous: previousState ?? undefined,
          upgradeInfo: authority,
          changes,
        });

        if (alerts.length > 0) {
          await dispatchAlerts(alerts, this.sinks);
          if (onEvent) {
            await onEvent({
              type: "alert",
              programId: this.config.programId,
              slot: current.slot,
              timestamp: Date.now(),
              state: current,
              alerts,
            });
          }
        }

        if (onEvent) {
          await onEvent({
            type: "state_update",
            programId: this.config.programId,
            slot: current.slot,
            timestamp: Date.now(),
            state: current,
          });
        }

        previousState = current;
      },
      this.config.intervalMs,
      this.abortController.signal,
    );
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}

export function createWatcher(config: WatcherConfig): ProgramWatcher {
  return new ProgramWatcher(config);
}
