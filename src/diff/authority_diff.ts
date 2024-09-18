import type { UpgradeAuthorityInfo } from "../monitor/rpc_poller.js";

export interface AuthorityDiffResult {
  hasChanges: boolean;
  authorityChanged: boolean;
  immutabilityChanged: boolean;
  previousAuthority: string | null;
  currentAuthority: string | null;
  previousImmutable: boolean;
  currentImmutable: boolean;
  programDataChanged: boolean;
  previousProgramData: string;
  currentProgramData: string;
  summary: string[];
}

export function diffAuthority(
  previous: UpgradeAuthorityInfo,
  current: UpgradeAuthorityInfo,
): AuthorityDiffResult {
  const authorityChanged = previous.upgradeAuthority !== current.upgradeAuthority;
  const immutabilityChanged = previous.isImmutable !== current.isImmutable;
  const programDataChanged = previous.programDataAddress !== current.programDataAddress;

  const summary: string[] = [];

  if (authorityChanged) {
    summary.push(
      `upgrade authority: ${previous.upgradeAuthority ?? "none"} -> ${current.upgradeAuthority ?? "none"}`,
    );
  }

  if (immutabilityChanged) {
    summary.push(
      `immutability: ${previous.isImmutable} -> ${current.isImmutable}`,
    );
  }

  if (programDataChanged) {
    summary.push(
      `program data address: ${previous.programDataAddress} -> ${current.programDataAddress}`,
    );
  }

  return {
    hasChanges: authorityChanged || immutabilityChanged || programDataChanged,
    authorityChanged,
    immutabilityChanged,
    previousAuthority: previous.upgradeAuthority,
    currentAuthority: current.upgradeAuthority,
    previousImmutable: previous.isImmutable,
    currentImmutable: current.isImmutable,
    programDataChanged,
    previousProgramData: previous.programDataAddress,
    currentProgramData: current.programDataAddress,
    summary,
  };
}

export function isAuthorityRevocation(diff: AuthorityDiffResult): boolean {
  return diff.authorityChanged && diff.currentAuthority === null && diff.previousAuthority !== null;
}

export function isAuthorityTransfer(diff: AuthorityDiffResult): boolean {
  return (
    diff.authorityChanged &&
    diff.previousAuthority !== null &&
    diff.currentAuthority !== null
  );
}

export function authorityRiskLevel(diff: AuthorityDiffResult): "none" | "low" | "medium" | "critical" {
  if (!diff.hasChanges) {
    return "none";
  }
  if (isAuthorityRevocation(diff)) {
    return "medium";
  }
  if (isAuthorityTransfer(diff)) {
    return "critical";
  }
  if (diff.immutabilityChanged && diff.currentImmutable) {
    return "low";
  }
  return "medium";
}

export function formatAuthorityDiff(diff: AuthorityDiffResult): string {
  if (!diff.hasChanges) {
    return "No authority changes detected";
  }

  const lines = ["Authority diff:", ...diff.summary.map((s) => `  ${s}`)];
  lines.push(`  Risk level: ${authorityRiskLevel(diff)}`);
  return lines.join("\n");
}
