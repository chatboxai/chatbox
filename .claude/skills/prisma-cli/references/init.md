# prisma init

Bootstraps a fresh Prisma ORM project in the current directory.

## Command

```bash
prisma init [options]
```

## Bun Runtime

If you're using Bun, run Prisma with `bunx --bun` so it doesn't fall back to Node.js:

```bash
bunx --bun prisma init
```

## What It Creates

- `prisma/schema.prisma` - Your Prisma schema file
- `prisma.config.ts` - TypeScript configuration for Prisma CLI
- `.env` - Environment variables (DATABASE_URL)
- `.gitignore` - Ensures `.env` is ignored and appends the generated client path

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--datasource-provider` | Database provider: `postgresql`, `mysql`, `sqlite`, `sqlserver`, `mongodb`, `cockroachdb` | `postgresql` |
| `--db` | Provisions a fully managed Prisma Postgres database on the Prisma Data Platform | - |
| `--url` | Define a custom datasource url | - |
| `--generator-provider` | Define the generator provider to use | `prisma-client` |
| `--output` | Define Prisma Client generator output path to use | - |
| `--preview-feature` | Define a preview feature to use | - |
| `--with-model` | Add example model to created schema file | - |

## Examples

### Basic initialization

```bash
prisma init
```

Creates a PostgreSQL project setup.

### SQLite project

```bash
prisma init --datasource-provider sqlite
```

### MySQL with custom URL

```bash
prisma init --datasource-provider mysql --url "mysql://user:password@localhost:3306/mydb"
```

### Prisma Postgres (cloud)

```bash
prisma init --db
```

Opens browser for authentication, creates cloud database instance.

### Add an example model

```bash
prisma init --with-model
```

Adds a starter model to the generated schema.

### With preview features

```bash
prisma init --preview-feature relationJoins --preview-feature fullTextSearch
```

## Generated Schema

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

## Generated Config (Node.js default)

```typescript
// prisma.config.ts
import "dotenv/config";
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
})
```

## Generated Config (Bun)

```typescript
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

## Next Steps After Init

1. Configure `DATABASE_URL` in `.env` (and let `prisma.config.ts` read it)
2. Define your models in `prisma/schema.prisma`
3. Run `prisma dev` for local development or connect to remote DB
4. Run `prisma migrate dev` to create migrations
5. Run `prisma generate` to generate Prisma Client
6. Run `prisma db seed` explicitly if you want seed data
