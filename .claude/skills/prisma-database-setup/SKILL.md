---
name: prisma-database-setup
description: Guides for configuring Prisma with different database providers (PostgreSQL, MySQL, SQLite, MongoDB, etc.). Use when setting up a new project, changing databases, or troubleshooting connection issues. Triggers on "configure postgres", "connect to mysql", "setup mongodb", "sqlite setup".
license: MIT
metadata:
  author: prisma
  version: "7.6.0"
---

# Prisma Database Setup

Comprehensive guides for configuring Prisma ORM with various database providers.

## When to Apply

Reference this skill when:
- Initializing a new Prisma project
- Switching database providers
- Configuring connection strings and environment variables
- Troubleshooting database connection issues
- Setting up database-specific features
- Generating and instantiating Prisma Client

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Provider Guides | CRITICAL | provider names |
| 2 | Prisma Postgres | HIGH | `prisma-postgres` |
| 3 | Client Setup | CRITICAL | `prisma-client-setup` |

## System Prerequisites

- **Node.js 20.19.0+**
- **TypeScript 5.4.0+**

## Bun Runtime

If you're using Bun, run Prisma CLI commands with `bunx --bun prisma ...` so Prisma uses the Bun runtime instead of falling back to Node.js.

## Supported Databases

| Database | Provider String | Notes |
|----------|-----------------|-------|
| PostgreSQL | `postgresql` | Default, full feature support |
| MySQL | `mysql` | Widespread support, some JSON diffs |
| SQLite | `sqlite` | Local file-based, no enum/scalar lists |
| MongoDB | `mongodb` | Mongo-specific workflow; do not apply SQL driver-adapter guidance |
| SQL Server | `sqlserver` | Microsoft ecosystem |
| CockroachDB | `cockroachdb` | Distributed SQL, Postgres-compatible |
| Prisma Postgres | `postgresql` | Managed serverless database |

## Configuration Files

Your configuration shape depends on the provider and Prisma major version:

1. **All providers** use **`prisma/schema.prisma`**.
2. **Prisma 7 SQL setups** typically use **`prisma.config.ts`** for datasource URLs.
3. **MongoDB projects should stay on Prisma 6.x**, keep `url = env("DATABASE_URL")` in the schema, and continue using the classic MongoDB setup.

## Driver Adapters

The standard SQL workflow uses a driver adapter. Choose the adapter and driver for your database and pass the adapter to `PrismaClient`.

| Database | Adapter | JS Driver |
|----------|---------|-----------|
| PostgreSQL | `@prisma/adapter-pg` | `pg` |
| CockroachDB | `@prisma/adapter-pg` | `pg` |
| Prisma Postgres (Node.js) | `@prisma/adapter-pg` | `pg` |
| Prisma Postgres (edge/serverless) | `@prisma/adapter-ppg` | `@prisma/ppg` |
| MySQL / MariaDB | `@prisma/adapter-mariadb` | `mariadb` |
| SQLite | `@prisma/adapter-better-sqlite3` | `better-sqlite3` |
| SQLite (Turso/LibSQL) | `@prisma/adapter-libsql` | `@libsql/client` |
| SQL Server | `@prisma/adapter-mssql` | `node-mssql` |

MongoDB should not follow the Prisma 7 SQL adapter workflow. Use the latest Prisma 6.x release for MongoDB projects and do not install a SQL `@prisma/adapter-*` package for it.

Example (PostgreSQL):

```ts
import 'dotenv/config'
import { PrismaClient } from '../generated/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
```

## Prisma Client Setup (Required)

Prisma Client must be installed and generated for any database.

1. Install Prisma CLI and Prisma Client:
   ```bash
   npm install prisma --save-dev
   npm install @prisma/client
   ```

1. Add a generator block (`prisma-client` requires an explicit output path):
   ```prisma
   generator client {
     provider = "prisma-client"
     output   = "../generated"
   }
   ```

1. Generate Prisma Client:
   ```bash
   npx prisma generate
   ```

1. For SQL providers, instantiate Prisma Client with the database-specific driver adapter:
   ```typescript
   import { PrismaClient } from '../generated/client'
   import { PrismaPg } from '@prisma/adapter-pg'

   const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
   const prisma = new PrismaClient({ adapter })
   ```

1. Re-run `prisma generate` after every schema change.

## Quick Reference

### PostgreSQL
```prisma
datasource db {
  provider = "postgresql"
}

generator client {
  provider = "prisma-client"
  output   = "../generated"
}
```

### MySQL
```prisma
datasource db {
  provider = "mysql"
}

generator client {
  provider = "prisma-client"
  output   = "../generated"
}
```

### SQLite
```prisma
datasource db {
  provider = "sqlite"
}

generator client {
  provider = "prisma-client"
  output   = "../generated"
}
```

### MongoDB
```prisma
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
```

For MongoDB, stay on the latest Prisma 6.x line and keep the connection URL in `schema.prisma`. Do not move a MongoDB project to the Prisma 7 SQL adapter setup.

## Rule Files

See individual rule files for detailed setup instructions:

```
references/postgresql.md
references/mysql.md
references/sqlite.md
references/mongodb.md
references/sqlserver.md
references/cockroachdb.md
references/prisma-postgres.md
references/prisma-client-setup.md
```

## How to Use

Choose the provider reference file for your database, then apply `references/prisma-client-setup.md` to complete client generation and adapter setup. For MongoDB, use `references/mongodb.md` instead of copying the SQL adapter examples or Prisma 7 config pattern.
