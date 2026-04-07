# create-db-cli

Use `create-db` for instant Prisma Postgres provisioning from the terminal.

## Priority

CRITICAL

## Why It Matters

`create-db` is the fastest way to get a working Prisma Postgres instance for development, demos, and CI previews. It can also emit machine-readable output and write env variables directly.

## Commands

```bash
npx create-db@latest
npx create-db@latest create [options]
npx create-db@latest regions
```

Aliases:

```bash
npx create-pg@latest
npx create-postgres@latest
```

## Command discovery (`--help`)

Always use `--help` first when integrating CLI commands:

```bash
npx create-db@latest --help
npx create-db@latest create --help
npx create-db@latest regions --help
```

Top-level commands currently exposed:

- `create` (default) to provision a database
- `regions` to list available regions

## `create` options

| Flag | Shorthand | Description |
|---|---|---|
| `--region [string]` | `-r` | Region choice: `ap-southeast-1`, `ap-northeast-1`, `eu-central-1`, `eu-west-3`, `us-east-1`, `us-west-1` |
| `--interactive [boolean]` | `-i` | Open region selector |
| `--json [boolean]` | `-j` | Output machine-readable JSON |
| `--env [string]` | `-e` | Write `DATABASE_URL` and `CLAIM_URL` into a target `.env` |
| `--ttl [string]` | `-t` | Auto-delete after a TTL like `30m` or `1h-24h` |
| `--copy [boolean]` | `-c` | Copy the connection string to the clipboard |
| `--quiet [boolean]` | `-q` | Only print the connection string |
| `--open [boolean]` | `-o` | Open the claim URL in your browser |

## Lifecycle and claim flow

- Databases are temporary by default.
- Unclaimed databases are auto-deleted after ~24 hours.
- Claim the database using the URL shown in command output to keep it permanently.

## Programmatic usage (library API)

You can also use `create-db` programmatically in Node.js/Bun instead of shelling out to the CLI.

Install:

```bash
npm install create-db
# or
bun add create-db
```

Create a database:

```ts
import { create, isDatabaseSuccess, isDatabaseError } from "create-db";

const result = await create({
  region: "us-east-1",
  userAgent: "my-app/1.0.0",
});

if (isDatabaseSuccess(result)) {
  console.log(result.connectionString);
  console.log(result.claimUrl);
  console.log(result.deletionDate);
}

if (isDatabaseError(result)) {
  console.error(result.error, result.message);
}
```

List regions programmatically:

```ts
import { regions } from "create-db";

const available = await regions();
console.log(available);
```

Programmatic `create()` defaults to `us-east-1` if no region is passed.

## Common patterns

```bash
# quick database
npx create-db@latest

# region-specific database
npx create-db@latest --region eu-central-1

# interactive region selection
npx create-db@latest --interactive

# write env vars for app bootstrap
npx create-db@latest --env .env

# auto-delete sooner
npx create-db@latest --ttl 2h

# copy connection string to clipboard
npx create-db@latest --copy

# print only the connection string
npx create-db@latest --quiet

# CI-friendly output
npx create-db@latest --json
```

## References

- [npx create-db docs](https://www.prisma.io/docs/postgres/introduction/npx-create-db)
