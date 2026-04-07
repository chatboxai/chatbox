# prisma migrate status

Checks the status of your database migrations.

## Command

```bash
prisma migrate status [options]
```

## What It Does

- Connects to the database
- Checks the `_prisma_migrations` table
- Compares applied migrations with local migration files
- Reports:
    - **Status**: Database is up-to-date or behind
    - **Unapplied migrations**: Count of pending migrations
    - **Missing migrations**: Migrations present in DB but missing locally
    - **Failed migrations**: Any migrations that failed to apply

## Options

| Option | Description |
|--------|-------------|
| `--schema` | Path to schema file |
| `--config` | Custom path to your Prisma config file |

## Examples

### Check status

```bash
prisma migrate status
```

Output example (Up to date):
```
Database schema is up to date!
```

Output example (Pending):
```
Following migration have not yet been applied:
  20240115120000_add_user

To apply migrations in development, run:
  prisma migrate dev

To apply migrations in production, run:
  prisma migrate deploy
```

## When to Use

- **Debugging**: Why is `migrate dev` complaining about drift?
- **CI/CD**: Verify database state before deploying
- **Production**: Check if migrations are needed (`migrate deploy`) or if a deployment failed

## Exit Codes

- `0`: Success (may have pending migrations, but command ran successfully)
- `1`: Error

To check for pending migrations programmatically, you might need to parse the output or use `migrate diff` with exit code flags.
