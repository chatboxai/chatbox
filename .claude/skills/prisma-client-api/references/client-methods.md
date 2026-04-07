# Client Methods

Prisma Client instance methods.

## $connect()

Explicitly connect to the database:

```typescript
const prisma = new PrismaClient({ adapter })

// Explicit connection
await prisma.$connect()
```

### When to use

Usually not needed - Prisma connects automatically on first query. Use for:
- Fail fast on startup
- Health checks
- Pre-warming connections

```typescript
async function main() {
  try {
    await prisma.$connect()
    console.log('Database connected')
  } catch (e) {
    console.error('Failed to connect:', e)
    process.exit(1)
  }
}
```

## $disconnect()

Close database connection:

```typescript
await prisma.$disconnect()
```

### Graceful shutdown

```typescript
process.on('beforeExit', async () => {
  await prisma.$disconnect()
})

// Or with SIGTERM
process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  process.exit(0)
})
```

### In tests

```typescript
afterAll(async () => {
  await prisma.$disconnect()
})
```

## $on()

Subscribe to events:

### Query events

```typescript
const prisma = new PrismaClient({
  adapter,
  log: [{ level: 'query', emit: 'event' }]
})

prisma.$on('query', (e) => {
  console.log('Query:', e.query)
  console.log('Params:', e.params)
  console.log('Duration:', e.duration, 'ms')
})
```

### Log events

```typescript
const prisma = new PrismaClient({
  adapter,
  log: [
    { level: 'info', emit: 'event' },
    { level: 'warn', emit: 'event' },
    { level: 'error', emit: 'event' }
  ]
})

prisma.$on('info', (e) => console.log(e.message))
prisma.$on('warn', (e) => console.warn(e.message))
prisma.$on('error', (e) => console.error(e.message))
```

## $extends()

Add extensions for custom behavior:

### Add custom methods

```typescript
const prisma = new PrismaClient({ adapter }).$extends({
  client: {
    $log: (message: string) => console.log(message)
  }
})

prisma.$log('Hello!')
```

### Add model methods

```typescript
const prisma = new PrismaClient({ adapter }).$extends({
  model: {
    user: {
      async findByEmail(email: string) {
        return prisma.user.findUnique({ where: { email } })
      }
    }
  }
})

const user = await prisma.user.findByEmail('alice@prisma.io')
```

### Query extensions

```typescript
const prisma = new PrismaClient({ adapter }).$extends({
  query: {
    user: {
      async findMany({ args, query }) {
        // Add default filter
        args.where = { ...args.where, deletedAt: null }
        return query(args)
      }
    }
  }
})
```

### Result extensions

```typescript
const prisma = new PrismaClient({ adapter }).$extends({
  result: {
    user: {
      fullName: {
        needs: { firstName: true, lastName: true },
        compute(user) {
          return `${user.firstName} ${user.lastName}`
        }
      }
    }
  }
})

const user = await prisma.user.findFirst()
console.log(user.fullName) // Computed field
```

### Chain extensions

```typescript
const prisma = new PrismaClient({ adapter })
  .$extends(loggingExtension)
  .$extends(softDeleteExtension)
  .$extends(computedFieldsExtension)
```

## $transaction()

See `transactions.md` for details.

## $queryRaw() / $executeRaw()

See `raw-queries.md` for details.

## Type utilities

### Prisma namespace

```typescript
import { Prisma } from '../generated/client'

// Input types
type UserCreateInput = Prisma.UserCreateInput
type UserWhereInput = Prisma.UserWhereInput

// Output types
type User = Prisma.UserGetPayload<{}>
type UserWithPosts = Prisma.UserGetPayload<{
  include: { posts: true }
}>
```

### Type-safe query fragments with satisfies

Type-safe query fragments:

```typescript
import { Prisma } from '../generated/client'

const userSelect = {
  id: true,
  email: true,
  name: true
} satisfies Prisma.UserSelect

const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: userSelect
})
```

With the `prisma-client` generator, use TypeScript `satisfies` for typed query fragments. You may still see older examples that use `Prisma.validator()` with `prisma-client-js`.
