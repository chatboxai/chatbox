---
name: prisma-upgrade-v7
description: Complete migration guide from Prisma ORM v6 to v7 covering all breaking changes. Use when upgrading Prisma versions, encountering v7 errors, or migrating existing projects. Triggers on "upgrade to prisma 7", "prisma 7 migration", "prisma-client generator", "driver adapter required".
license: MIT
metadata:
  author: prisma
  version: "7.6.0"
---

# Upgrade to Prisma ORM 7

Complete guide for migrating from Prisma ORM v6 to v7. This upgrade introduces significant breaking changes around the new `prisma-client` generator, driver adapters, `prisma.config.ts`, explicit environment loading, and generated client entrypoints.

## When to Apply

Reference this skill when:
- Upgrading from Prisma v6 to v7
- Updating to the `prisma-client` generator
- Setting up driver adapters
- Configuring `prisma.config.ts`
- Fixing import errors after upgrade

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Schema Migration | CRITICAL | `schema-changes` |
| 2 | Database Connectivity | CRITICAL | `driver-adapters` |
| 3 | Module System | CRITICAL | `esm-support` |
| 4 | Config and Env | HIGH | `prisma-config`, `env-variables` |
| 5 | Removed Features | HIGH | `removed-features` |
| 6 | Accelerate | HIGH | `accelerate-users` |

## Quick Reference

- `schema-changes` - generator migration, required output paths, generated entrypoints, and `Prisma.validator` replacement
- `driver-adapters` - required adapter installation for SQL providers, pool differences, and Prisma Postgres adapter choices
- `esm-support` - ESM-first setup plus CommonJS fallback with `moduleFormat = "cjs"`
- `prisma-config` - creating and using `prisma.config.ts`
- `env-variables` - explicit environment loading
- `removed-features` - removed middleware, metrics, and legacy CLI behavior
- `accelerate-users` - migration notes for Accelerate users

## Important Notes

- **MongoDB projects should stay on Prisma 6.x** - do not migrate MongoDB apps to Prisma 7's SQL client path
- **Node.js 20.19.0+** required
- **TypeScript 5.4.0+** required
- **Latest stable Prisma ORM version**: `7.6.0`

## Upgrade Steps Overview

1. Update packages to v7
2. Choose your module format (`esm` by default, `cjs` if needed)
3. Update TypeScript configuration
4. Update the schema generator block
5. Create `prisma.config.ts`
6. Install and configure a driver adapter for SQL providers
7. Update Prisma Client imports
8. Update client instantiation
9. Replace deprecated helper patterns like `Prisma.validator`
10. Run `prisma generate` and test

## Quick Upgrade Commands

```bash
# Update packages
npm install @prisma/client@7
npm install -D prisma@7

# Install a driver adapter (PostgreSQL or Prisma Postgres via direct TCP)
npm install @prisma/adapter-pg pg

# Install dotenv for env loading
npm install dotenv

# Regenerate client
npx prisma generate
```

## Breaking Changes Summary

| Change | v6 | v7 |
|--------|----|----|
| Module format | Implicit / mixed | ESM-first, `moduleFormat = "cjs"` supported |
| Generator provider | `prisma-client-js` | `prisma-client` is the default, while `prisma-client-js` still exists for legacy setups |
| Output path | Auto (node_modules) | Required explicit |
| Driver adapters | Optional | Required for SQL providers |
| Config file | `.env` + schema | `prisma.config.ts` |
| Env loading | Automatic | Manual (dotenv) |
| Generated entrypoints | Single package export | `client`, `browser`, `models`, `enums` entrypoints |
| Type-safe query fragments | `Prisma.validator()` | TypeScript `satisfies` |
| Middleware | `$use()` | Client Extensions |
| Metrics | Preview feature | Removed |

## Rule Files

Detailed migration guides for each breaking change:

```
references/esm-support.md        - ESM and CommonJS configuration
references/schema-changes.md     - Generator, output, imports, and generated entrypoints
references/driver-adapters.md    - Required driver adapter setup
references/prisma-config.md      - New configuration file
references/env-variables.md      - Environment variable loading
references/removed-features.md   - Middleware, metrics, and CLI flags
references/accelerate-users.md   - Special handling for Accelerate
```

## Step-by-Step Migration

### 1. Update package.json for ESM-first projects

```json
{
  "type": "module"
}
```

If you need to stay on CommonJS, keep your app as CJS and set `moduleFormat = "cjs"` in the generator block instead of forcing ESM.

### 2. Update tsconfig.json

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2023",
    "strict": true,
    "esModuleInterop": true
  }
}
```

### 3. Update schema.prisma

```prisma
// Before (v6)
generator client {
  provider = "prisma-client-js"
}

// After (v7)
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
  // Optional if you need CommonJS:
  // moduleFormat = "cjs"
}
```

### 4. Create prisma.config.ts

```typescript
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

### 5. Install a driver adapter (SQL providers only)

```bash
# PostgreSQL
npm install @prisma/adapter-pg pg

# MySQL
npm install @prisma/adapter-mariadb mariadb

# SQLite
npm install @prisma/adapter-better-sqlite3 better-sqlite3

# Prisma Postgres in standard Node.js apps (recommended)
npm install @prisma/adapter-pg pg

# Prisma Postgres serverless driver (edge/serverless)
npm install @prisma/adapter-ppg @prisma/ppg

# Neon
npm install @prisma/adapter-neon
```

MongoDB does not have a SQL `@prisma/adapter-*` package in the published Prisma 7.6.0 packages. If you're upgrading a MongoDB project, stop and keep that project on the latest Prisma 6.x release instead of following the standard Prisma 7 migration path.

### 6. Update client instantiation

```typescript
// Before (v6)
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

// After (v7)
import { PrismaClient } from '../generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL
})

const prisma = new PrismaClient({ adapter })
```

### 7. Replace Prisma.validator with satisfies

```typescript
import { Prisma } from '../generated/prisma/client'

const userSelect = {
  id: true,
  email: true,
  name: true,
} satisfies Prisma.UserSelect
```

### 8. Run migrations and generate

```bash
npx prisma generate
npx prisma migrate dev  # if needed
```

## Troubleshooting

### "Cannot find module" errors
- Check that the generator `output` path matches your import path
- Ensure `prisma generate` ran successfully

### SSL certificate errors
- Add `ssl: { rejectUnauthorized: false }` to the adapter config if you need to preserve old behavior
- Or configure your certificates properly with `NODE_EXTRA_CA_CERTS` / OpenSSL CA settings

### Connection timeout issues
- Driver adapters use the underlying driver's defaults, which differ from v6
- Configure pool settings explicitly on the adapter if needed

## Resources

- [Official v7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrades/to-v7)
- [Driver Adapters Documentation](https://www.prisma.io/docs/orm/core-concepts/supported-databases/database-drivers)
- [Prisma Config Reference](https://www.prisma.io/docs/orm/reference/prisma-config-reference)

## How to Use

Follow `references/schema-changes.md` and `references/driver-adapters.md` first, then apply the remaining reference files based on your project setup.
