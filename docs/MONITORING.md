# Monitoring Guide

## Architecture

```
RPC Poller ──▶ State Diff ──▶ Alert Rules ──▶ Output
     │                              │
     └── Upgrade Authority Parse ───┘
```

## Polling

The `pollProgram` function fetches program state at a configurable interval and compares against the previous snapshot. Changes trigger callbacks and alert evaluation.

Default interval: 30 seconds (15 seconds in watch mode).

## Upgrade Authority Detection

For BPF upgradeable programs:

1. Read program account data bytes 4-36 for program data address
2. Fetch program data account
3. Parse byte 12 for authority option (0 = immutable, 1 = mutable)
4. Extract authority pubkey from bytes 13-45

## Custom Alert Rules

```typescript
import { AlertRule, evaluateRules } from "./alerts/alert_rules.js";

const MY_RULE: AlertRule = {
  name: "custom_check",
  severity: "warning",
  evaluate: (ctx) => {
    if (ctx.current.lamports < 1000000) {
      return {
        id: "custom_1",
        rule: "custom_check",
        severity: "warning",
        programId: ctx.programId,
        message: "Low lamport balance on program account",
        timestamp: Date.now(),
        details: { lamports: ctx.current.lamports },
      };
    }
    return null;
  },
};
```

## Security Use Cases

- Monitor DeFi protocols you interact with for unauthorized upgrades
- Track upgrade authority renouncement (immutable flag)
- Alert on unexpected program data changes before user funds are at risk
