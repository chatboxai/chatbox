# prisma db push

Pushes schema changes directly to database without creating migrations. Ideal for prototyping.

## Command

```bash
prisma db push [options]
```

## What It Does

- Syncs your Prisma schema to the database
- Creates database if it doesn't exist
- Does NOT create migration files
- Does NOT track migration history

## Options

| Option | Description |
|--------|-------------|
| `--force-reset` | Force a reset of the database before push |
| `--accept-data-loss` | Ignore data loss warnings |
| `--schema` | Custom path to your Prisma schema |
| `--config` | Custom path to your Prisma config file |
| `--url` | Override the datasource URL from the Prisma config file |

### Follow-up Command

- Run `prisma generate` explicitly when you need refreshed client output

## Examples

### Basic push

```bash
prisma db push
```

### Accept data loss

```bash
prisma db push --accept-data-loss
```

Required when changes would delete data (dropping columns, etc.)

### Force reset

```bash
prisma db push --force-reset
```

Completely resets database and applies schema.

### Full workflow

```bash
prisma db push
prisma generate
```

## When to Use

- **Prototyping** - Rapid schema iteration
- **Local development** - Quick schema changes
- **MongoDB** - Primary workflow (migrations not supported)
- **Testing** - Setting up test databases

## When NOT to Use

- **Production** - Use `migrate deploy`
- **Team collaboration** - Use migrations for trackable changes
- **When you need rollback** - Migrations provide history

## Comparison with migrate dev

| Feature | db push | migrate dev |
|---------|---------|-------------|
| Creates migration files | No | Yes |
| Tracks history | No | Yes |
| Requires shadow database | No | Yes |
| Speed | Faster | Slower |
| Rollback capability | No | Yes |
| Best for | Prototyping | Development |

## MongoDB Workflow

MongoDB doesn't support migrations. Use `db push` exclusively:

```bash
# Schema changes for MongoDB
prisma db push
prisma generate
```

## Common Patterns

### Prototyping workflow

```bash
# Make schema changes
# ...

# Push to database
prisma db push

# Generate client
prisma generate

# Test your changes
# Repeat as needed
```

### Reset and start fresh

```bash
prisma db push --force-reset
prisma db seed
```

### Handling conflicts

If `db push` can't apply changes safely:

```
Error: The following changes cannot be applied:
  - Removing field `email` would cause data loss
  
Use --accept-data-loss to proceed
```

Decide whether data loss is acceptable, then:

```bash
prisma db push --accept-data-loss
```

## Transition to Migrations

When ready for production, switch to migrations:

```bash
# Create baseline migration from current schema
prisma migrate dev --name init
```

Then use `migrate dev` for future changes.
