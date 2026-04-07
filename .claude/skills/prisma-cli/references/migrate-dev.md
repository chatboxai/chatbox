# prisma migrate dev

Creates and applies migrations during development. Requires a shadow database.

## Command

```bash
prisma migrate dev [options]
```

## What It Does

1. Runs existing migrations in shadow database to detect drift
2. Applies any pending migrations
3. Generates new migration from schema changes
4. Applies new migration to development database
5. Updates `_prisma_migrations` table

## Options

| Option | Description |
|--------|-------------|
| `--name` / `-n` | Name the migration |
| `--create-only` | Create a new migration but do not apply it |
| `--schema` | Custom path to your Prisma schema |
| `--config` | Custom path to your Prisma config file |
| `--url` | Override the datasource URL from the Prisma config file |

### Follow-up Commands

- Run `prisma generate` explicitly when you need refreshed client output
- Run `prisma db seed` explicitly when you need seed data

Note: Prisma CLI help for `7.6.0` still says `migrate dev` "trigger[s] generators", but local verification in a temp Prisma 7.6.0 project did not emit generated client files. Treat `prisma generate` as an explicit follow-up step when you need generated artifacts on disk.

## Examples

### Create and apply migration

```bash
prisma migrate dev
```

Prompts for migration name if schema changed.

### Named migration

```bash
prisma migrate dev --name add_users_table
```

### Create without applying

```bash
prisma migrate dev --create-only
```

Useful for reviewing migration SQL before applying.

### Full workflow

```bash
prisma migrate dev --name my_migration
prisma generate
prisma db seed
```

## Migration Files

Created in `prisma/migrations/`:

```
prisma/migrations/
├── 20240115120000_add_users_table/
│   └── migration.sql
├── 20240116090000_add_posts/
│   └── migration.sql
└── migration_lock.toml
```

## Schema Drift Detection

If `migrate dev` detects drift (manual database changes or edited migrations), it prompts to reset:

```
Drift detected: Your database schema is not in sync.

Do you want to reset your database? All data will be lost.
```

## When to Use

- Local development
- Adding new models/fields
- Changing relations
- Creating indexes

## When NOT to Use

- Production deployments (use `migrate deploy`)
- CI/CD pipelines (use `migrate deploy`)
- MongoDB (use `db push` instead)

## Common Patterns

### After schema changes

```prisma
// schema.prisma - Add new field
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())  // New field
}
```

```bash
prisma migrate dev --name add_created_at
```

### Handling data loss warnings

When a migration would cause data loss:

```bash
prisma migrate dev --name remove_field
# Warning: You are about to delete data...
# Accept with: --accept-data-loss
```

## Shadow Database

`migrate dev` requires a shadow database for drift detection. Configure in `prisma.config.ts`:

```typescript
export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
    shadowDatabaseUrl: env('SHADOW_DATABASE_URL'),
  },
})
```

For local Prisma Postgres (`prisma dev`), shadow database is handled automatically.
