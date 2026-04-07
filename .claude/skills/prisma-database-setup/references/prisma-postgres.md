# Prisma Postgres Setup

Configure Prisma with Prisma Postgres (Managed).

## Overview

Prisma Postgres is a serverless, managed PostgreSQL database optimized for Prisma.

## Setup via CLI

You can provision a Prisma Postgres instance directly via the CLI:

```bash
prisma init --db
```

This will:
1. Log you into Prisma Data Platform.
2. Create a new project and database instance.
3. Update your `.env` with the connection string.

## Connection String

For Prisma CLI flows and Accelerate-style usage, you may see a `prisma+postgres://` URL.

For Prisma Client with a driver adapter in Node.js, prefer the direct TCP connection string from the Prisma Postgres dashboard:

```env
DATABASE_URL="postgres://identifier:key@db.prisma.io:5432/postgres?sslmode=require"
```

## 1. Schema Configuration

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql" // Use postgresql provider
}

generator client {
  provider = "prisma-client"
  output   = "../generated"
}
```

## 2. Config Configuration

In `prisma.config.ts`:

```typescript
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

## Driver Adapter

Use a driver adapter for Prisma Postgres in the standard SQL workflow.

### Recommended for standard Node.js apps

1. Install adapter and driver:
   ```bash
   npm install @prisma/adapter-pg pg
   ```

2. Use the direct TCP connection string from Prisma Console:
   ```typescript
   import 'dotenv/config'
   import { PrismaClient } from '../generated/client'
   import { PrismaPg } from '@prisma/adapter-pg'

   const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
   const prisma = new PrismaClient({ adapter })
   ```

`PrismaPg` also accepts the connection string directly:

```typescript
const adapter = new PrismaPg(process.env.DATABASE_URL!)
const prisma = new PrismaClient({ adapter })
```

For PostgreSQL prepared statement naming, pass adapter options as the second argument:

```typescript
import { createHash } from 'node:crypto'

const adapter = new PrismaPg(process.env.DATABASE_URL!, {
  statementNameGenerator: ({ sql }) =>
    `prisma_${createHash('sha1').update(sql).digest('hex').slice(0, 16)}`,
})
```

### Edge/serverless option

Use the Prisma Postgres serverless driver only when you need HTTP/WebSocket transport in environments like Workers or Edge Functions:

```bash
npm install @prisma/adapter-ppg @prisma/ppg
```

```typescript
import { PrismaClient } from '../generated/client'
import { PrismaPostgresAdapter } from '@prisma/adapter-ppg'

const prisma = new PrismaClient({
  adapter: new PrismaPostgresAdapter({
    connectionString: process.env.PRISMA_DIRECT_TCP_URL,
  }),
})
```

This serverless driver is the specialized path for HTTP/WebSocket-based edge and serverless runtimes, not the default recommendation for standard Node.js apps.

## Features

- **Serverless**: Scales to zero.
- **Caching**: Integrated query caching (Accelerate).
- **Real-time**: Database events (Pulse).

## Using with Prisma Client

Use the Prisma Postgres adapter shown above when instantiating Prisma Client.
