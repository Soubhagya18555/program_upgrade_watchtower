import type { Alert } from "./alert_rules.js";
import { formatAlert } from "./alert_rules.js";

export interface AlertSink {
  name: string;
  emit(alert: Alert): void | Promise<void>;
}

export class ConsoleAlertSink implements AlertSink {
  name = "console";

  emit(alert: Alert): void {
    console.log(formatAlert(alert));
  }
}

export class CollectingAlertSink implements AlertSink {
  name = "collector";
  alerts: Alert[] = [];

  emit(alert: Alert): void {
    this.alerts.push(alert);
  }

  clear(): void {
    this.alerts = [];
  }

  getBySeverity(severity: Alert["severity"]): Alert[] {
    return this.alerts.filter((a) => a.severity === severity);
  }
}

export class JsonFileAlertSink implements AlertSink {
  name = "json_file";
  private buffer: Alert[] = [];

  constructor(private filePath: string) {}

  emit(alert: Alert): void {
    this.buffer.push(alert);
  }

  async flush(): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.buffer, null, 2));
    this.buffer = [];
  }
}

export class WebhookAlertSink implements AlertSink {
  name = "webhook";

  constructor(private url: string) {}

  async emit(alert: Alert): Promise<void> {
    try {
      await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: alert.id,
          rule: alert.rule,
          severity: alert.severity,
          programId: alert.programId,
          message: alert.message,
          timestamp: alert.timestamp,
          details: alert.details,
        }),
      });
    } catch {
      console.error(`Failed to send webhook alert to ${this.url}`);
    }
  }
}

export async function dispatchAlerts(alerts: Alert[], sinks: AlertSink[]): Promise<void> {
  for (const alert of alerts) {
    for (const sink of sinks) {
      await sink.emit(alert);
    }
  }
}

export function filterAlertsBySeverity(
  alerts: Alert[],
  minSeverity: Alert["severity"],
): Alert[] {
  const order: Record<Alert["severity"], number> = {
    info: 0,
    warning: 1,
    critical: 2,
  };
  const threshold = order[minSeverity];
  return alerts.filter((a) => order[a.severity] >= threshold);
}

export function summarizeAlerts(alerts: Alert[]): {
  total: number;
  critical: number;
  warning: number;
  info: number;
} {
  return {
    total: alerts.length,
    critical: alerts.filter((a) => a.severity === "critical").length,
    warning: alerts.filter((a) => a.severity === "warning").length,
    info: alerts.filter((a) => a.severity === "info").length,
  };
}
