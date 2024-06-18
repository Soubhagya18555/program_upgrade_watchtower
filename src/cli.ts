import { Connection } from "@solana/web3.js";
import { evaluateRules, formatAlert, DEFAULT_RULES } from "./alerts/alert_rules.js";
import {
  fetchProgramState,
  fetchUpgradeAuthority,
  pollProgram,
} from "./monitor/rpc_poller.js";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const programId = args[0] ?? TOKEN_PROGRAM;
  const rpc = args[1] ?? "https://api.mainnet-beta.solana.com";
  const watch = args.includes("--watch");

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

  const alerts = evaluateRules({
    programId,
    current: state,
    upgradeInfo,
    changes: [],
  }, DEFAULT_RULES);

  if (alerts.length > 0) {
    console.log("\nAlerts:");
    for (const alert of alerts) {
      console.log(formatAlert(alert));
    }
  }

  if (watch) {
    console.log("\nWatching for changes (Ctrl+C to stop)...\n");
    await pollProgram(
      connection,
      programId,
      async (current, changes) => {
        const upgrade = await fetchUpgradeAuthority(connection, programId);
        const newAlerts = evaluateRules({
          programId,
          current,
          upgradeInfo: upgrade,
          changes,
        });

        console.log(`[slot ${current.slot}] Changes detected:`);
        for (const c of changes) console.log(`  ${c}`);
        for (const alert of newAlerts) console.log(formatAlert(alert));
      },
      15000
    );
  }
}

main().catch(console.error);
