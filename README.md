# program_upgrade_watchtower

Monitor Solana program account changes with upgrade authority detection, RPC polling, and configurable alert rules.

**Author:** Soubhagya  
**License:** MIT

## Features

- Fetch program account state (executable, owner, data length, lamports)
- Parse BPF upgradeable loader for upgrade authority
- Detect state changes between poll cycles
- Alert rules for upgrades, owner changes, and authority exposure

## Install

```bash
npm install
npm run build
```

## Usage

```bash
npm run start -- [PROGRAM_ID] [RPC_URL] [--watch]
```

Examples:

```bash
npm run start -- TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
npm run start -- TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA https://api.mainnet-beta.solana.com --watch
```

## Alert Rules

| Rule | Severity | Trigger |
|------|----------|---------|
| upgrade_authority_changed | critical | Active upgrade authority detected |
| data_length_changed | warning | Program data size changed |
| owner_changed | critical | Account owner changed |
| program_upgraded | critical | Likely upgrade event |

## Documentation

- [docs/MONITORING.md](docs/MONITORING.md)

## Library

```typescript
import { Connection } from "@solana/web3.js";
import { fetchUpgradeAuthority, pollProgram, evaluateRules } from "program_upgrade_watchtower";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const info = await fetchUpgradeAuthority(connection, "PROGRAM_ID");
console.log(info.upgradeAuthority, info.isImmutable);
```
