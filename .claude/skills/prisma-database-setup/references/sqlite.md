# SQLite Setup

Configure Prisma with SQLite.

## Prerequisites

- None (file-based)

## 1. Schema Configuration

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "sqlite"
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

## 3. Environment Variable

In `.env`:

```env
DATABASE_URL="file:./dev.db"
```

### Connection String Format

```
file:PATH
```

- **PATH**: Relative path to the database file. Check `prisma.config.ts` if you need to confirm how your app resolves it.

## Driver Adapter

Use a driver adapter for the standard SQL workflow.

1. Install adapter and driver:
   ```bash
   npm install @prisma/adapter-better-sqlite3 better-sqlite3
   ```

2. Instantiate Prisma Client with the adapter:
   ```typescript
   import { PrismaClient } from '../generated/client'
   import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

   const adapter = new PrismaBetterSqlite3({
     url: process.env.DATABASE_URL ?? 'file:./dev.db',
   })

   const prisma = new PrismaClient({ adapter })
   ```

## Using Driver Adapter (LibSQL / Turso)

For edge compatibility or Turso:

1. Install:
   ```bash
   npm install @prisma/adapter-libsql @libsql/client
   ```

2. Instantiate:
   ```typescript
   import { PrismaClient } from '../generated/client'
   import { PrismaLibSql } from '@prisma/adapter-libsql'

   const adapter = new PrismaLibSql({
     url: process.env.TURSO_DATABASE_URL,
     authToken: process.env.TURSO_AUTH_TOKEN,
   })
   const prisma = new PrismaClient({ adapter })
   ```

## Limitations

- **No Enums**: SQLite doesn't support enums (Prisma polyfills them or treats as String).
- **No Scalar Lists**: `String[]` is not supported directly.
- **Concurrency**: Write operations lock the file.

## Common Issues

### "Database file not found"
Ensure the path in `DATABASE_URL` is correct relative to where Prisma is running or the schema file. `file:./dev.db` creates it next to schema.
