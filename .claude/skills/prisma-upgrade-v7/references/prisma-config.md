# Prisma Config

Prisma v7 introduces `prisma.config.ts` as the central configuration file for the Prisma CLI.

## Location

Place `prisma.config.ts` at your project root (next to `package.json`).

## Basic Configuration

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

## Configuration Options

### schema

Path to your Prisma schema file:

```typescript
schema: 'prisma/schema.prisma'
```

### datasource.url

Database connection URL:

```typescript
datasource: {
  url: env('DATABASE_URL'),
}
```

### datasource.directUrl

Direct connection URL (bypassing connection pooler):

```typescript
datasource: {
  url: env('DATABASE_URL'),
  directUrl: env('DIRECT_DATABASE_URL'),
}
```

### datasource.shadowDatabaseUrl

Shadow database for migrations:

```typescript
datasource: {
  url: env('DATABASE_URL'),
  shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
}
```

### migrations.path

Directory for migration files:

```typescript
migrations: {
  path: 'prisma/migrations',
}
```

### migrations.seed

Seed command for `prisma db seed`:

```typescript
migrations: {
  path: 'prisma/migrations',
  seed: 'tsx prisma/seed.ts',
}
```

## Full Example

```typescript
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  // Schema location
  schema: 'prisma/schema.prisma',
  
  // Migration configuration
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  
  // Database connection
  datasource: {
    url: env('DATABASE_URL'),
    directUrl: env('DIRECT_DATABASE_URL'),
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
})
```

## Environment Variables

### The env() helper

Use `env()` to reference environment variables:

```typescript
import { env } from 'prisma/config'

datasource: {
  url: env('DATABASE_URL'),
}
```

This provides type safety but does NOT load .env files automatically.

### Loading .env files

Install and import dotenv:

```bash
npm install dotenv
```

```typescript
import 'dotenv/config'  // Must be first import
import { defineConfig, env } from 'prisma/config'
```

## Migrating from v6

### Before (v6) - schema.prisma

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

### After (v7) - prisma.config.ts

```typescript
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
    directUrl: env('DIRECT_URL'),
  },
})
```

And update schema.prisma:

```prisma
datasource db {
  provider = "postgresql"
  // URLs now in prisma.config.ts
}
```

## Custom Config Path

Use `--config` flag with CLI commands:

```bash
prisma migrate dev --config ./config/prisma.config.ts
```

## Monorepo Configuration

```typescript
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'
import path from 'path'

export default defineConfig({
  schema: path.join(__dirname, 'packages/database/prisma/schema.prisma'),
  migrations: {
    path: path.join(__dirname, 'packages/database/prisma/migrations'),
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```
