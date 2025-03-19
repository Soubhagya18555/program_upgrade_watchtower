import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diffAuthority, isAuthorityRevocation, authorityRiskLevel } from "../diff/authority_diff.js";
import { SnapshotStore } from "../store/snapshot_store.js";
import { CollectingAlertSink, filterAlertsBySeverity, summarizeAlerts } from "../alerts/alert_sink.js";
import { evaluateRules, DEFAULT_RULES } from "../alerts/alert_rules.js";
import type { ProgramAccountState, UpgradeAuthorityInfo } from "../monitor/rpc_poller.js";

function makeState(overrides: Partial<ProgramAccountState> = {}): ProgramAccountState {
  return {
    programId: "prog1",
    executable: true,
    owner: "BPFLoaderUpgradeab1e11111111111111111111111",
    dataLength: 1000,
    lamports: 5000,
    slot: 100,
    fetchedAt: Date.now(),
    ...overrides,
  };
}

function makeAuthority(overrides: Partial<UpgradeAuthorityInfo> = {}): UpgradeAuthorityInfo {
  return {
    programId: "prog1",
    programDataAddress: "data_addr",
    upgradeAuthority: "auth1",
    isImmutable: false,
    slot: 100,
    ...overrides,
  };
}

describe("authority_diff", () => {
  it("detects authority transfer", () => {
    const prev = makeAuthority({ upgradeAuthority: "auth1" });
    const curr = makeAuthority({ upgradeAuthority: "auth2" });
    const diff = diffAuthority(prev, curr);
    assert.equal(diff.hasChanges, true);
    assert.equal(diff.authorityChanged, true);
    assert.equal(authorityRiskLevel(diff), "critical");
  });

  it("detects authority revocation", () => {
    const prev = makeAuthority({ upgradeAuthority: "auth1" });
    const curr = makeAuthority({ upgradeAuthority: null, isImmutable: true });
    const diff = diffAuthority(prev, curr);
    assert.ok(isAuthorityRevocation(diff));
  });
});

describe("snapshot_store", () => {
  it("saves and retrieves snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "watchtower_"));
    try {
      const store = new SnapshotStore(dir);
      const state = makeState({ slot: 200 });
      const authority = makeAuthority({ slot: 200 });

      store.save("prog1", state, authority);
      const latest = store.getLatest("prog1");
      assert.ok(latest);
      assert.equal(latest!.state.slot, 200);

      const bySlot = store.getBySlot("prog1", 200);
      assert.ok(bySlot);

      const list = store.listSnapshots("prog1");
      assert.equal(list.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compares snapshots across slots", () => {
    const dir = mkdtempSync(join(tmpdir(), "watchtower_"));
    try {
      const store = new SnapshotStore(dir);
      store.save("prog1", makeState({ slot: 100, dataLength: 1000 }), makeAuthority({ slot: 100 }));
      store.save("prog1", makeState({ slot: 200, dataLength: 2000 }), makeAuthority({ slot: 200 }));

      const comparison = store.compareSlots("prog1", 100, 200);
      assert.ok(comparison.stateChanges.length > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("alert_sink", () => {
  it("collects and filters alerts", () => {
    const sink = new CollectingAlertSink();
    const state = makeState();
    const authority = makeAuthority();

    const alerts = evaluateRules({
      programId: "prog1",
      current: state,
      upgradeInfo: authority,
      changes: [],
    }, DEFAULT_RULES);

    for (const alert of alerts) {
      sink.emit(alert);
    }

    assert.ok(sink.alerts.length >= 0);
    const summary = summarizeAlerts(sink.alerts);
    assert.equal(summary.total, sink.alerts.length);

    const critical = filterAlertsBySeverity(sink.alerts, "critical");
    assert.ok(critical.length <= sink.alerts.length);
  });
});
