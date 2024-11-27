import { Connection, PublicKey } from "@solana/web3.js";

export interface ProgramAccountState {
  programId: string;
  executable: boolean;
  owner: string;
  dataLength: number;
  lamports: number;
  slot: number;
  fetchedAt: number;
}

export interface UpgradeAuthorityInfo {
  programId: string;
  programDataAddress: string;
  upgradeAuthority: string | null;
  isImmutable: boolean;
  slot: number;
}

export interface PollConfig {
  intervalMs: number;
  rpcUrl: string;
  commitment: "processed" | "confirmed" | "finalized";
}

export const DEFAULT_POLL_CONFIG: PollConfig = {
  intervalMs: 30000,
  rpcUrl: "https://api.mainnet-beta.solana.com",
  commitment: "confirmed",
};

export async function fetchProgramState(
  connection: Connection,
  programId: string
): Promise<ProgramAccountState> {
  const pubkey = new PublicKey(programId);
  const accountInfo = await connection.getAccountInfo(pubkey);
  const slot = await connection.getSlot();

  return {
    programId,
    executable: accountInfo?.executable ?? false,
    owner: accountInfo?.owner.toBase58() ?? "unknown",
    dataLength: accountInfo?.data.length ?? 0,
    lamports: accountInfo?.lamports ?? 0,
    slot,
    fetchedAt: Date.now(),
  };
}

export async function fetchUpgradeAuthority(
  connection: Connection,
  programId: string
): Promise<UpgradeAuthorityInfo> {
  const programPubkey = new PublicKey(programId);
  const programAccount = await connection.getAccountInfo(programPubkey);
  const slot = await connection.getSlot();

  if (!programAccount || !programAccount.executable) {
    return {
      programId,
      programDataAddress: "",
      upgradeAuthority: null,
      isImmutable: true,
      slot,
    };
  }

  if (programAccount.data.length < 36) {
    return {
      programId,
      programDataAddress: "",
      upgradeAuthority: null,
      isImmutable: true,
      slot,
    };
  }

  const programDataPubkey = new PublicKey(programAccount.data.subarray(4, 36));
  const programDataAccount = await connection.getAccountInfo(programDataPubkey);

  if (!programDataAccount) {
    return {
      programId,
      programDataAddress: programDataPubkey.toBase58(),
      upgradeAuthority: null,
      isImmutable: true,
      slot,
    };
  }

  const authorityOption = programDataAccount.data[12];
  let upgradeAuthority: string | null = null;

  if (authorityOption === 1 && programDataAccount.data.length >= 45) {
    upgradeAuthority = new PublicKey(programDataAccount.data.subarray(13, 45)).toBase58();
  }

  return {
    programId,
    programDataAddress: programDataPubkey.toBase58(),
    upgradeAuthority,
    isImmutable: upgradeAuthority === null,
    slot,
  };
}

export function detectStateChange(
  previous: ProgramAccountState,
  current: ProgramAccountState
): string[] {
  const changes: string[] = [];

  if (previous.dataLength !== current.dataLength) {
    changes.push(`data_length: ${previous.dataLength} -> ${current.dataLength}`);
  }
  if (previous.lamports !== current.lamports) {
    changes.push(`lamports: ${previous.lamports} -> ${current.lamports}`);
  }
  if (previous.owner !== current.owner) {
    changes.push(`owner: ${previous.owner} -> ${current.owner}`);
  }
  if (previous.executable !== current.executable) {
    changes.push(`executable: ${previous.executable} -> ${current.executable}`);
  }

  return changes;
}

export async function pollProgram(
  connection: Connection,
  programId: string,
  onUpdate: (state: ProgramAccountState, changes: string[]) => void,
  intervalMs: number,
  signal?: AbortSignal
): Promise<void> {
  let previous = await fetchProgramState(connection, programId);

  while (!signal?.aborted) {
    await sleep(intervalMs);
    if (signal?.aborted) break;

    const current = await fetchProgramState(connection, programId);
    const changes = detectStateChange(previous, current);

    if (changes.length > 0) {
      onUpdate(current, changes);
    }

    previous = current;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
