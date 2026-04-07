# prisma db seed

Runs your database seed script to populate data.

## Command

```bash
prisma db seed [options]
```

## What It Does

- Executes your configured seed script
- Populates database with initial/test data
- Runs independently (not auto-run by migrations in v7)

## Options

| Option | Description |
|--------|-------------|
| `--config` | Custom path to your Prisma config file |
| `--` | Pass custom arguments to seed script |

## Configuration

Configure seed script in `prisma.config.ts`:

```typescript
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',  // Your seed command
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

### Common seed commands

```typescript
// TypeScript with tsx
seed: 'tsx prisma/seed.ts'

// TypeScript with ts-node
seed: 'ts-node prisma/seed.ts'

// JavaScript
seed: 'node prisma/seed.js'
```

## Seed Script Example

```typescript
// prisma/seed.ts
import { PrismaClient } from '../generated/client'

const prisma = new PrismaClient()

async function main() {
  // Create users
  const alice = await prisma.user.upsert({
    where: { email: 'alice@prisma.io' },
    update: {},
    create: {
      email: 'alice@prisma.io',
      name: 'Alice',
      posts: {
        create: {
          title: 'Hello World',
          published: true,
        },
      },
    },
  })

  const bob = await prisma.user.upsert({
    where: { email: 'bob@prisma.io' },
    update: {},
    create: {
      email: 'bob@prisma.io',
      name: 'Bob',
    },
  })

  console.log({ alice, bob })
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
```

## Examples

### Run seed

```bash
prisma db seed
```

### With custom arguments

```bash
prisma db seed -- --environment development
```

Arguments after `--` are passed to your seed script.

## Current Workflow

Run seeding explicitly after migrations when you need seed data:

```bash
prisma migrate dev --name init
prisma generate
prisma db seed  # Must run explicitly
```

## Idempotent Seeding

Use `upsert` to make seeds re-runnable:

```typescript
// Good: Can run multiple times
await prisma.user.upsert({
  where: { email: 'alice@prisma.io' },
  update: {},  // Don't change existing
  create: { email: 'alice@prisma.io', name: 'Alice' },
})

// Bad: Fails on second run
await prisma.user.create({
  data: { email: 'alice@prisma.io', name: 'Alice' },
})
```

## Common Patterns

### Development reset

```bash
prisma migrate reset --force
prisma db seed
```

### Conditional seeding

```typescript
// prisma/seed.ts
const count = await prisma.user.count()
if (count === 0) {
  // Only seed if empty
  await seedUsers()
}
```

### Environment-specific seeds

```typescript
// prisma/seed.ts
const env = process.env.NODE_ENV || 'development'

if (env === 'development') {
  await seedDevData()
} else if (env === 'test') {
  await seedTestData()
}
```

## Best Practices

1. Use `upsert` for idempotent seeds
2. Keep seeds focused and minimal
3. Use realistic but fake data
4. Document required seed data
5. Version control your seed scripts
