# Environment Variables

Prisma v7 no longer automatically loads environment variables. You must load them explicitly.

## The Change

### v6 Behavior

Prisma CLI automatically loaded `.env` files.

### v7 Behavior

You must manually load environment variables using `dotenv` or similar.

## Setup

### 1. Install dotenv

```bash
npm install dotenv
```

### 2. Import in prisma.config.ts

```typescript
import 'dotenv/config'  // Must be first import
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

## Bun Users

Bun automatically loads `.env` files. No additional setup needed:

```typescript
// prisma.config.ts (Bun)
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

## Multiple .env Files

### Using dotenv-cli

```bash
npm install -D dotenv-cli
```

```json
{
  "scripts": {
    "db:migrate": "dotenv -e .env.local -- prisma migrate dev",
    "db:push": "dotenv -e .env.development -- prisma db push"
  }
}
```

### Using dotenv with path

```typescript
// prisma.config.ts
import { config } from 'dotenv'
import path from 'path'

// Load specific .env file
config({ path: path.join(__dirname, '.env.local') })

import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

## Application Code

For your application, load env vars at startup:

### Entry point

```typescript
// index.ts
import 'dotenv/config'

import { PrismaClient } from '../generated/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!
})

const prisma = new PrismaClient({ adapter })
```

### Or use dotenv explicitly

```typescript
import { config } from 'dotenv'
config()

// Now process.env.DATABASE_URL is available
```

## Removed Environment Variables

These Prisma-specific env vars are removed in v7:

| Removed Variable | Alternative |
|-----------------|-------------|
| `PRISMA_CLI_QUERY_ENGINE_TYPE` | Not needed (no engines) |
| `PRISMA_CLIENT_ENGINE_TYPE` | Not needed (no engines) |
| `PRISMA_QUERY_ENGINE_BINARY` | Not needed |
| `PRISMA_QUERY_ENGINE_LIBRARY` | Not needed |
| `PRISMA_GENERATE_SKIP_AUTOINSTALL` | Not needed |
| `PRISMA_SKIP_POSTINSTALL_GENERATE` | Not needed |
| `PRISMA_GENERATE_IN_POSTINSTALL` | Not needed |
| `PRISMA_GENERATE_DATAPROXY` | Migrate to `prisma-client` with driver adapters |
| `PRISMA_GENERATE_NO_ENGINE` | Migrate to `prisma-client` with driver adapters |
| `PRISMA_CLIENT_NO_RETRY` | Configure on adapter |
| `PRISMA_MIGRATE_SKIP_GENERATE` | Not needed (auto-generate removed) |
| `PRISMA_MIGRATE_SKIP_SEED` | Not needed (auto-seed removed) |

## TypeScript env() Helper

The `env()` function from `prisma/config` provides type safety:

```typescript
import { env } from 'prisma/config'

// Type-safe environment variable access
const url = env('DATABASE_URL')  // string
```

Note: This only works within `prisma.config.ts`, not in your application code.

## CI/CD Considerations

Ensure environment variables are set in your CI environment:

```yaml
# GitHub Actions
env:
  DATABASE_URL: ${{ secrets.DATABASE_URL }}

steps:
  - run: npx prisma migrate deploy
```

No need for dotenv in CI if variables are set directly.
