import { Connection } from "@solana/web3.js";
import { CollectingAlertSink, summarizeAlerts } from "./alerts/alert_sink.js";
import { evaluateRules, formatAlert, DEFAULT_RULES } from "./alerts/alert_rules.js";
import { diffAuthority, formatAuthorityDiff } from "./diff/authority_diff.js";
import {
  fetchProgramState,
  fetchUpgradeAuthority,
  pollProgram,
} from "./monitor/rpc_poller.js";
import { SnapshotStore } from "./store/snapshot_store.js";
import { createWatcher } from "./watchers/program_watcher.js";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const programId = args[0] ?? TOKEN_PROGRAM;
  const rpc = args[1] ?? "https://api.mainnet-beta.solana.com";
  const watch = args.includes("--watch");
  const snapshotDir = args.includes("--store")
    ? args[args.indexOf("--store") + 1] ?? "./snapshots"
    : undefined;

  const connection = new Connection(rpc, "confirmed");

  console.log(`Program Upgrade Watchtower`);
  console.log(`Program: ${programId}`);
  console.log(`RPC: ${rpc}\n`);

  const state = await fetchProgramState(connection, programId);
  console.log("Current state:");
  console.log(JSON.stringify(state, null, 2));

  const upgradeInfo = await fetchUpgradeAuthority(connection, programId);
  console.log("\nUpgrade authority:");
  console.log(JSON.stringify(upgradeInfo, null, 2));

  if (snapshotDir) {
    const store = new SnapshotStore(snapshotDir);
    store.save(programId, state, upgradeInfo);
    console.log(`\nSnapshot saved to ${snapshotDir}`);
  }

  const alerts = evaluateRules(
    {
      programId,
      current: state,
      upgradeInfo,
      changes: [],
    },
    DEFAULT_RULES,
  );

  if (alerts.length > 0) {
    console.log("\nAlerts:");
    for (const alert of alerts) {
      console.log(formatAlert(alert));
    }
    console.log(summarizeAlerts(alerts));
  }

  if (watch) {
    if (snapshotDir) {
      const watcher = createWatcher({
        programId,
        rpcUrl: rpc,
        intervalMs: 15000,
        commitment: "confirmed",
        snapshotDir,
      });
      console.log("\nWatching via ProgramWatcher (Ctrl+C to stop)...\n");
      await watcher.start(async (event) => {
        if (event.authorityDiff) {
          console.log(formatAuthorityDiff(event.authorityDiff));
        }
        for (const alert of event.alerts ?? []) {
          console.log(formatAlert(alert));
        }
      });
      return;
    }

    console.log("\nWatching for changes (Ctrl+C to stop)...\n");
    let previousAuthority = upgradeInfo;
    await pollProgram(
      connection,
      programId,
      async (current, changes) => {
        const upgrade = await fetchUpgradeAuthority(connection, programId);
        const authorityDiff = diffAuthority(previousAuthority, upgrade);
        previousAuthority = upgrade;

        const newAlerts = evaluateRules({
          programId,
          current,
          upgradeInfo: upgrade,
          changes,
        });

        console.log(`[slot ${current.slot}] Changes detected:`);
        for (const c of changes) {
          console.log(`  ${c}`);
        }
        if (authorityDiff.hasChanges) {
          console.log(formatAuthorityDiff(authorityDiff));
        }
        for (const alert of newAlerts) {
          console.log(formatAlert(alert));
        }

        const sink = new CollectingAlertSink();
        for (const alert of newAlerts) {
          sink.emit(alert);
        }
        if (sink.alerts.length > 0) {
          console.log(summarizeAlerts(sink.alerts));
        }
      },
      15000,
    );
  }
}

main().catch(console.error);
