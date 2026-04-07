# prisma db execute

Execute native commands (SQL) to your database.

## Command

```bash
prisma db execute [options]
```

## What It Does

- Connects to your database using the configured datasource
- Executes a script provided via file (`--file`) or stdin (`--stdin`)
- Useful for running raw SQL, maintenance tasks, or applying diffs from `migrate diff`
- Not supported on MongoDB

## Options

| Option | Description |
|--------|-------------|
| `--file` | Path to a file containing the script to execute |
| `--stdin` | Use terminal standard input as the script |
| `--config` | Custom path to your Prisma config file |

## Current Option Surface

`prisma db execute` uses the datasource configured in `prisma.config.ts`. Use `--config` if you need a separate config file for another environment.

## Examples

### Execute from file

```bash
prisma db execute --file ./script.sql
```

### Execute from stdin

```bash
echo "TRUNCATE TABLE User;" | prisma db execute --stdin
```

### Execute `migrate diff` output

Pipe the output of `migrate diff` directly to the database:

```bash
prisma migrate diff \
  --from-empty \
  --to-schema prisma/schema.prisma \
  --script \
| prisma db execute --stdin
```

## Configuration

Uses `datasource` from `prisma.config.ts`:

```typescript
export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

## Use Cases

- **Manual Migrations**: Applying raw SQL changes
- **Data Maintenance**: Truncating tables, cleaning up data
- **Schema Synchronization**: Applying `migrate diff` scripts
- **Debugging**: Running test queries (though typically not for fetching data)

## Limitations

- **No Data Return**: The command reports success/failure, not query results (rows). Use Prisma Client or `prisma studio` to view data.
- **SQL Only**: Primarily for SQL databases.
