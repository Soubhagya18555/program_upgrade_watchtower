import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ProgramAccountState, UpgradeAuthorityInfo } from "../monitor/rpc_poller.js";

export interface StoredSnapshot {
  programId: string;
  state: ProgramAccountState;
  authority: UpgradeAuthorityInfo;
  storedAt: number;
}

export interface SnapshotStoreOptions {
  baseDir?: string;
  maxSnapshots?: number;
}

export class SnapshotStore {
  private baseDir: string;
  private maxSnapshots: number;
  private memoryCache = new Map<string, StoredSnapshot[]>();

  constructor(baseDir?: string, options: SnapshotStoreOptions = {}) {
    this.baseDir = options.baseDir ?? baseDir ?? join(process.cwd(), ".watchtower_snapshots");
    this.maxSnapshots = options.maxSnapshots ?? 100;
    mkdirSync(this.baseDir, { recursive: true });
  }

  private programDir(programId: string): string {
    const dir = join(this.baseDir, programId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private snapshotPath(programId: string, slot: number): string {
    return join(this.programDir(programId), `snapshot_${slot}.json`);
  }

  save(programId: string, state: ProgramAccountState, authority: UpgradeAuthorityInfo): StoredSnapshot {
    const snapshot: StoredSnapshot = {
      programId,
      state,
      authority,
      storedAt: Date.now(),
    };

    const path = this.snapshotPath(programId, state.slot);
    writeFileSync(path, JSON.stringify(snapshot, null, 2));

    const cache = this.memoryCache.get(programId) ?? [];
    cache.push(snapshot);
    if (cache.length > this.maxSnapshots) {
      cache.shift();
    }
    this.memoryCache.set(programId, cache);

    this.pruneOldSnapshots(programId);
    return snapshot;
  }

  getLatest(programId: string): StoredSnapshot | null {
    const cache = this.memoryCache.get(programId);
    if (cache && cache.length > 0) {
      return cache[cache.length - 1]!;
    }

    const dir = this.programDir(programId);
    if (!existsSync(dir)) {
      return null;
    }

    const files = readdirSync(dir)
      .filter((f) => f.startsWith("snapshot_") && f.endsWith(".json"))
      .sort();

    if (files.length === 0) {
      return null;
    }

    const latest = files[files.length - 1]!;
    const content = readFileSync(join(dir, latest), "utf8");
    return JSON.parse(content) as StoredSnapshot;
  }

  getBySlot(programId: string, slot: number): StoredSnapshot | null {
    const path = this.snapshotPath(programId, slot);
    if (!existsSync(path)) {
      return null;
    }
    return JSON.parse(readFileSync(path, "utf8")) as StoredSnapshot;
  }

  listSnapshots(programId: string): StoredSnapshot[] {
    const dir = this.programDir(programId);
    if (!existsSync(dir)) {
      return [];
    }

    return readdirSync(dir)
      .filter((f) => f.startsWith("snapshot_") && f.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as StoredSnapshot);
  }

  compareSlots(programId: string, slotA: number, slotB: number): {
    snapshotA: StoredSnapshot | null;
    snapshotB: StoredSnapshot | null;
    stateChanges: string[];
    authorityChanged: boolean;
  } {
    const snapshotA = this.getBySlot(programId, slotA);
    const snapshotB = this.getBySlot(programId, slotB);
    const stateChanges: string[] = [];

    if (snapshotA && snapshotB) {
      if (snapshotA.state.dataLength !== snapshotB.state.dataLength) {
        stateChanges.push(`data_length: ${snapshotA.state.dataLength} -> ${snapshotB.state.dataLength}`);
      }
      if (snapshotA.state.lamports !== snapshotB.state.lamports) {
        stateChanges.push(`lamports: ${snapshotA.state.lamports} -> ${snapshotB.state.lamports}`);
      }
      if (snapshotA.state.owner !== snapshotB.state.owner) {
        stateChanges.push(`owner: ${snapshotA.state.owner} -> ${snapshotB.state.owner}`);
      }
    }

    return {
      snapshotA,
      snapshotB,
      stateChanges,
      authorityChanged:
        snapshotA?.authority.upgradeAuthority !== snapshotB?.authority.upgradeAuthority,
    };
  }

  private pruneOldSnapshots(programId: string): void {
    const dir = this.programDir(programId);
    const files = readdirSync(dir)
      .filter((f) => f.startsWith("snapshot_") && f.endsWith(".json"))
      .sort();

    while (files.length > this.maxSnapshots) {
      const oldest = files.shift()!;
      unlinkSync(join(dir, oldest));
    }
  }
}
