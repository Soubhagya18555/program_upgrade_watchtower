import type { ProgramAccountState, UpgradeAuthorityInfo } from "../monitor/rpc_poller.js";

export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
  id: string;
  rule: string;
  severity: AlertSeverity;
  programId: string;
  message: string;
  timestamp: number;
  details: Record<string, unknown>;
}

export interface AlertRule {
  name: string;
  severity: AlertSeverity;
  evaluate: (ctx: RuleContext) => Alert | null;
}

export interface RuleContext {
  programId: string;
  current: ProgramAccountState;
  previous?: ProgramAccountState;
  upgradeInfo?: UpgradeAuthorityInfo;
  changes: string[];
}

let alertCounter = 0;

function nextAlertId(): string {
  alertCounter += 1;
  return `alert_${alertCounter}_${Date.now()}`;
}

export const UPGRADE_AUTHORITY_CHANGED: AlertRule = {
  name: "upgrade_authority_changed",
  severity: "critical",
  evaluate: (ctx) => {
    if (!ctx.upgradeInfo) return null;
    if (ctx.upgradeInfo.isImmutable) return null;

    return {
      id: nextAlertId(),
      rule: "upgrade_authority_changed",
      severity: "critical",
      programId: ctx.programId,
      message: `Program ${ctx.programId} has active upgrade authority: ${ctx.upgradeInfo.upgradeAuthority}`,
      timestamp: Date.now(),
      details: {
        upgradeAuthority: ctx.upgradeInfo.upgradeAuthority,
        programDataAddress: ctx.upgradeInfo.programDataAddress,
      },
    };
  },
};

export const DATA_LENGTH_CHANGED: AlertRule = {
  name: "data_length_changed",
  severity: "warning",
  evaluate: (ctx) => {
    const dataChange = ctx.changes.find((c) => c.startsWith("data_length:"));
    if (!dataChange) return null;

    return {
      id: nextAlertId(),
      rule: "data_length_changed",
      severity: "warning",
      programId: ctx.programId,
      message: `Program data changed: ${dataChange}`,
      timestamp: Date.now(),
      details: { change: dataChange },
    };
  },
};

export const OWNER_CHANGED: AlertRule = {
  name: "owner_changed",
  severity: "critical",
  evaluate: (ctx) => {
    const ownerChange = ctx.changes.find((c) => c.startsWith("owner:"));
    if (!ownerChange) return null;

    return {
      id: nextAlertId(),
      rule: "owner_changed",
      severity: "critical",
      programId: ctx.programId,
      message: `Program owner changed: ${ownerChange}`,
      timestamp: Date.now(),
      details: { change: ownerChange },
    };
  },
};

export const PROGRAM_UPGRADED: AlertRule = {
  name: "program_upgraded",
  severity: "critical",
  evaluate: (ctx) => {
    if (!ctx.previous) return null;
    if (ctx.current.dataLength === ctx.previous.dataLength) return null;
    if (ctx.current.executable !== ctx.previous.executable) return null;

    return {
      id: nextAlertId(),
      rule: "program_upgraded",
      severity: "critical",
      programId: ctx.programId,
      message: `Possible program upgrade detected on ${ctx.programId}`,
      timestamp: Date.now(),
      details: {
        previousLength: ctx.previous.dataLength,
        currentLength: ctx.current.dataLength,
        slot: ctx.current.slot,
      },
    };
  },
};

export const DEFAULT_RULES: AlertRule[] = [
  UPGRADE_AUTHORITY_CHANGED,
  DATA_LENGTH_CHANGED,
  OWNER_CHANGED,
  PROGRAM_UPGRADED,
];

export function evaluateRules(ctx: RuleContext, rules: AlertRule[] = DEFAULT_RULES): Alert[] {
  const alerts: Alert[] = [];
  for (const rule of rules) {
    const alert = rule.evaluate(ctx);
    if (alert) alerts.push(alert);
  }
  return alerts;
}

export function formatAlert(alert: Alert): string {
  return `[${alert.severity.toUpperCase()}] ${alert.rule}: ${alert.message}`;
}
