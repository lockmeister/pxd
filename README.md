# pxd - Universal Tag System

Tag anything with a unique, grep-able ID that works everywhere.

## ID Format

`px[a-z2-9]{7}` - e.g., `pxk8f3m2n`

- 9 chars, fits any field (bank refs, URLs, etc.)
- Alphanumeric only, no parser-breaking chars
- `px` prefix won't match hex/SHA/UUID

## Setup

```bash
# Install deps
npm install

# Create D1 database (first time only)
npm run db:create
# Copy the database_id to wrangler.toml

# Initialize schema
npm run db:init

# Set secrets
wrangler secret put PXD_ADMIN_KEY
wrangler secret put PXD_AGENT_KEY

# Deploy
npm run deploy

# Install CLI globally
npm install -g .
```

## CLI Usage

```bash
pxd new "Echo project"           # Create tag, copy ID to clipboard
pxd show pxk8f3m2n               # Show tag details
pxd link pxk8f3m2n github https://github.com/...
pxd search "echo"                # Search by name
pxd list                         # List all tags
pxd work pxk8f3m2n               # Set active project
```

## Config

`~/.pxd/config.json`:

```json
{
  "api_url": "https://pxd.lockmeister.workers.dev",
  "admin_key": "your-admin-key"
}
```

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /id | agent+ | Create tag |
| GET | /id/:id | agent+ | Get tag |
| PUT | /id/:id | admin | Update tag |
| DELETE | /id/:id | admin | Delete tag |
| POST | /id/:id/link | agent+ | Add link |
| DELETE | /id/:id/link/:type | admin | Remove link |
| GET | /search?q= | agent+ | Search |
| GET | /list | agent+ | List all |
| GET | /health | public | Health check |

## Insertion Rules

Always delimit with non-alphanumeric:

| Context | Format | Example |
|---------|--------|---------|
| Inline | `ref:ID` | `ref:pxk8f3m2n` |
| Titles | `Name (ID)` | `Echo (pxk8f3m2n)` |
| Resources | `name-ID` | `token-pxk8f3m2n` |
| Commits | `[ID] msg` | `[pxk8f3m2n] fix` |

See [full documentation](https://github.com/lockmeister/pxd).
