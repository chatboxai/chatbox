# Prisma Client Setup

Generate and instantiate Prisma Client for Prisma's standard SQL provider workflow. For MongoDB, follow the provider-specific notes in `references/mongodb.md` instead of copying the SQL adapter example below.

## 1. Install dependencies

```bash
npm install prisma --save-dev
npm install @prisma/client
```

## 2. Add generator block

In `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated"
}
```

`prisma-client` requires an explicit `output` path and does not generate into `node_modules` by default.

## 3. Generate Prisma Client

```bash
npx prisma generate
```

Re-run `prisma generate` after every schema change to keep the client in sync.

## 4. Instantiate Prisma Client

```typescript
import { PrismaClient } from '../generated/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
```

If you change the generator `output`, update the import path to match. For the SQL provider workflow, replace `PrismaPg` with the adapter for your database.

## 5. Use a single instance

Each `PrismaClient` instance creates a connection pool. Reuse a single instance per app process to avoid exhausting database connections.
