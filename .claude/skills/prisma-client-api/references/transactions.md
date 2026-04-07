# Transactions

Execute multiple operations atomically.

## Sequential Transactions

Array of operations executed in order:

```typescript
const [user, post] = await prisma.$transaction([
  prisma.user.create({ data: { email: 'alice@prisma.io' } }),
  prisma.post.create({ data: { title: 'Hello', authorId: 1 } })
])
```

### All or nothing

If any operation fails, all are rolled back:

```typescript
try {
  await prisma.$transaction([
    prisma.user.create({ data: { email: 'alice@prisma.io' } }),
    prisma.user.create({ data: { email: 'alice@prisma.io' } }) // Duplicate!
  ])
} catch (e) {
  // Both operations rolled back
}
```

## Interactive Transactions

For complex logic and dependent operations:

```typescript
await prisma.$transaction(async (tx) => {
  // Decrement sender balance
  const sender = await tx.account.update({
    where: { id: senderId },
    data: { balance: { decrement: amount } }
  })
  
  // Check balance
  if (sender.balance < 0) {
    throw new Error('Insufficient funds')
  }
  
  // Increment recipient balance
  await tx.account.update({
    where: { id: recipientId },
    data: { balance: { increment: amount } }
  })
})
```

### Transaction options

```typescript
await prisma.$transaction(
  async (tx) => {
    // operations
  },
  {
    maxWait: 5000,    // Max wait to acquire lock (ms)
    timeout: 10000,   // Max transaction duration (ms)
    isolationLevel: 'Serializable'  // Isolation level
  }
)
```

### Isolation levels

| Level | Description |
|-------|-------------|
| `ReadUncommitted` | Lowest isolation, can read uncommitted changes |
| `ReadCommitted` | Only read committed changes |
| `RepeatableRead` | Consistent reads within transaction |
| `Serializable` | Highest isolation, serialized execution |

## Nested Writes

Automatic transactions for nested operations:

```typescript
// This is automatically a transaction
const user = await prisma.user.create({
  data: {
    email: 'alice@prisma.io',
    posts: {
      create: [
        { title: 'Post 1' },
        { title: 'Post 2' }
      ]
    },
    profile: {
      create: { bio: 'Hello!' }
    }
  }
})
```

## Transaction Client

The `tx` parameter is a Prisma Client scoped to the transaction:

```typescript
await prisma.$transaction(async (tx) => {
  // Use tx instead of prisma
  await tx.user.create({ ... })
  await tx.post.create({ ... })
  
  // Can call methods
  const count = await tx.user.count()
})
```

## OrThrow in Transactions

Use with interactive transactions:

```typescript
await prisma.$transaction(async (tx) => {
  // If not found, throws and rolls back entire transaction
  const user = await tx.user.findUniqueOrThrow({
    where: { id: 1 }
  })
  
  await tx.post.create({
    data: { title: 'New Post', authorId: user.id }
  })
})
```

## Best Practices

### Keep transactions short

```typescript
// Good - only DB operations in transaction
const data = prepareData() // Outside transaction
await prisma.$transaction(async (tx) => {
  await tx.user.create({ data })
})
```

### Handle errors

```typescript
try {
  await prisma.$transaction(async (tx) => {
    // operations
  })
} catch (e) {
  if (e.code === 'P2002') {
    // Handle unique constraint violation
  }
  throw e
}
```

### Use appropriate isolation

```typescript
// Default is fine for most cases
await prisma.$transaction(async (tx) => {
  // operations
})

// Use Serializable for strict consistency
await prisma.$transaction(
  async (tx) => { /* operations */ },
  { isolationLevel: 'Serializable' }
)
```

## Sequential vs Interactive

| Feature | Sequential | Interactive |
|---------|------------|-------------|
| Syntax | Array | Async function |
| Dependent ops | No | Yes |
| Conditional logic | No | Yes |
| Performance | Better | More flexible |
| Use case | Simple batch | Complex logic |
