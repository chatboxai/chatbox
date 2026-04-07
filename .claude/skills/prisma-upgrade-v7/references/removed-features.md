# Removed Features

Several features have been removed in Prisma v7. Here's how to migrate.

## Client Middleware

### Removed

```typescript
// ❌ No longer works in v7
prisma.$use(async (params, next) => {
  const before = Date.now()
  const result = await next(params)
  const after = Date.now()
  console.log(`Query took ${after - before}ms`)
  return result
})
```

### Use Client Extensions Instead

```typescript
// ✅ v7 approach
const prisma = new PrismaClient({ adapter }).$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, model, args, query }) {
        const before = Date.now()
        const result = await query(args)
        const after = Date.now()
        console.log(`${model}.${operation} took ${after - before}ms`)
        return result
      },
    },
  },
})
```

### Common Middleware Patterns

#### Soft delete

```typescript
const prisma = new PrismaClient({ adapter }).$extends({
  query: {
    user: {
      async delete({ args, query }) {
        // Convert delete to soft delete
        return prisma.user.update({
          where: args.where,
          data: { deletedAt: new Date() },
        })
      },
      async findMany({ args, query }) {
        // Filter out soft-deleted records
        args.where = { ...args.where, deletedAt: null }
        return query(args)
      },
    },
  },
})
```

#### Logging

```typescript
const prisma = new PrismaClient({ adapter }).$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, model, args, query }) {
        console.log(`${model}.${operation}`, JSON.stringify(args))
        return query(args)
      },
    },
  },
})
```

## Metrics

### Removed

The Metrics preview feature has been removed.

```typescript
// ❌ No longer works
const metrics = await prisma.$metrics.json()
```

### Alternatives

#### Custom counter with extensions

```typescript
let totalQueries = 0

const prisma = new PrismaClient({ adapter }).$extends({
  client: {
    async $totalQueries() {
      return totalQueries
    },
  },
  query: {
    $allModels: {
      async $allOperations({ query, args }) {
        totalQueries += 1
        return query(args)
      },
    },
  },
})

// Usage
const count = await prisma.$totalQueries()
```

#### Use driver-level metrics

Access metrics from the underlying driver adapter.

## CLI Flags Removed

### --skip-generate

Removed from `migrate dev` and `db push`.

```bash
# v6
prisma migrate dev --skip-generate

# v7 - generate is not run automatically
prisma migrate dev
prisma generate  # Run explicitly if needed
```

Local verification with Prisma `7.6.0` showed no generated client files emitted by `migrate dev` or `db push`, even though some CLI help text still says `migrate dev` "trigger[s] generators".

### --skip-seed

Removed from `migrate dev`. More importantly, Prisma v7 no longer auto-runs seeds during `migrate dev` or `migrate reset`, so seed explicitly when you need it.

```bash
# v6
prisma migrate dev --skip-seed

# v7 - seed is not run automatically
prisma migrate dev
prisma db seed  # Run explicitly if needed
```

### --schema and --url from db execute

```bash
# v6
prisma db execute --file ./script.sql --url "$DATABASE_URL"

# v7 - configure in prisma.config.ts
prisma db execute --file ./script.sql
```

## migrate diff Options

| Removed | Replacement |
|---------|-------------|
| `--from-url` | `--from-config-datasource` |
| `--to-url` | `--to-config-datasource` |
| `--from-schema-datasource` | `--from-config-datasource` |
| `--to-schema-datasource` | `--to-config-datasource` |
| `--shadow-database-url` | Configure in `prisma.config.ts` |

### Example

```bash
# v6
prisma migrate diff --from-url "$DATABASE_URL" --to-schema schema.prisma

# v7
prisma migrate diff --from-config-datasource --to-schema schema.prisma
```

## Automatic Behaviors Removed

### Auto-generate after migrate

```bash
# v7 workflow
prisma migrate dev --name add_field
prisma generate  # Must run explicitly
```

### Auto-seed after migrate

```bash
# v7 workflow
prisma migrate reset --force
prisma db seed  # Must run explicitly
```

## Prisma.validator

The `prisma-client` generator no longer exposes `Prisma.validator`. Use TypeScript's `satisfies` operator instead.

```typescript
import { Prisma } from '../generated/prisma/client'

const userSelect = {
  id: true,
  email: true,
} satisfies Prisma.UserSelect
```

## rejectOnNotFound

Removed in v5.0.0 (already deprecated).

```typescript
// ❌ Removed
const prisma = new PrismaClient({
  rejectOnNotFound: true,
})

// ✅ Use OrThrow methods
const user = await prisma.user.findUniqueOrThrow({
  where: { id: 1 },
})

const user = await prisma.user.findFirstOrThrow({
  where: { email: 'test@example.com' },
})
```
