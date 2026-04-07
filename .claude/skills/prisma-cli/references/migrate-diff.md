# prisma migrate diff

Compares database schemas and generates diffs (SQL or summary).

## Command

```bash
prisma migrate diff [options]
```

## What It Does

- Compares two sources (`--from-...` and `--to-...`)
- Sources can be:
    - Empty (`empty`)
    - Schema file (`schema`)
    - Migrations directory (`migrations`)
    - Database URL (`url`) or Configured Datasource (`config-datasource`)
- Outputs the difference:
    - Human-readable summary (default)
    - SQL script (`--script`)

## Options

| Option | Description |
|--------|-------------|
| `--script` | Render SQL script to stdout |
| `--exit-code` | Exit 2 if changes detected, 0 if empty, 1 if error |
| `--config` | Custom path to your Prisma config file |

### Sources (Must provide one `from` and one `to`)

- `--from-empty`, `--to-empty`
- `--from-schema <path>`, `--to-schema <path>`
- `--from-migrations <path>`, `--to-migrations <path>`
- `--from-url <url>`, `--to-url <url>`
- `--from-config-datasource`, `--to-config-datasource` (uses `prisma.config.ts`)

## Examples

### Generate SQL for a schema change

Compare current production DB to your local schema:

```bash
prisma migrate diff \
  --from-url "$PROD_DB_URL" \
  --to-schema ./prisma/schema.prisma \
  --script
```

### Review pending migrations

Compare database state to migrations directory:

```bash
prisma migrate diff \
  --from-config-datasource \
  --to-migrations ./prisma/migrations
```

### Create baseline migration

Compare empty state to current schema:

```bash
prisma migrate diff \
  --from-empty \
  --to-schema ./prisma/schema.prisma \
  --script > prisma/migrations/0_init/migration.sql
```

### Check for drift (CI)

Check if database matches schema:

```bash
prisma migrate diff \
  --from-config-datasource \
  --to-schema ./prisma/schema.prisma \
  --exit-code
```

## Use Cases

- **Forward-generating migrations**: Creating SQL without `migrate dev`.
- **Drift detection**: Checking if DB is in sync.
- **Baselining**: Creating initial migration from existing DB.
- **Debugging**: Understanding what `migrate dev` would do.
