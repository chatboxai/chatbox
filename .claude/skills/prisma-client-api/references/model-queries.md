# Model Queries

CRUD operations for your Prisma models.

## Read Operations

### findUnique

Find a single record by unique field:

```typescript
const user = await prisma.user.findUnique({
  where: { id: 1 }
})

const user = await prisma.user.findUnique({
  where: { email: 'alice@prisma.io' }
})
```

#### With composite unique key

```typescript
// Model with @@unique([firstName, lastName])
const user = await prisma.user.findUnique({
  where: {
    firstName_lastName: {
      firstName: 'Alice',
      lastName: 'Smith'
    }
  }
})
```

### findUniqueOrThrow

Same as findUnique but throws if not found:

```typescript
const user = await prisma.user.findUniqueOrThrow({
  where: { id: 1 }
})
// Throws PrismaClientKnownRequestError if not found
```

### findFirst

Find first matching record:

```typescript
const user = await prisma.user.findFirst({
  where: { role: 'ADMIN' },
  orderBy: { createdAt: 'desc' }
})
```

### findFirstOrThrow

```typescript
const user = await prisma.user.findFirstOrThrow({
  where: { role: 'ADMIN' }
})
```

### findMany

Find multiple records:

```typescript
const users = await prisma.user.findMany({
  where: { role: 'USER' },
  orderBy: { name: 'asc' },
  take: 10,
  skip: 0
})
```

## Create Operations

### create

Create a single record:

```typescript
const user = await prisma.user.create({
  data: {
    email: 'alice@prisma.io',
    name: 'Alice'
  }
})
```

#### With relations

```typescript
const user = await prisma.user.create({
  data: {
    email: 'alice@prisma.io',
    posts: {
      create: [
        { title: 'First Post' },
        { title: 'Second Post' }
      ]
    }
  },
  include: { posts: true }
})
```

### createMany

Create multiple records:

```typescript
const result = await prisma.user.createMany({
  data: [
    { email: 'alice@prisma.io', name: 'Alice' },
    { email: 'bob@prisma.io', name: 'Bob' }
  ],
  skipDuplicates: true  // Skip records with duplicate unique fields
})
// Returns { count: 2 }
```

### createManyAndReturn

Create multiple and return them:

```typescript
const users = await prisma.user.createManyAndReturn({
  data: [
    { email: 'alice@prisma.io', name: 'Alice' },
    { email: 'bob@prisma.io', name: 'Bob' }
  ]
})
// Returns array of created users
```

## Update Operations

### update

Update a single record:

```typescript
const user = await prisma.user.update({
  where: { id: 1 },
  data: { name: 'Alice Smith' }
})
```

#### Atomic operations

```typescript
const post = await prisma.post.update({
  where: { id: 1 },
  data: {
    views: { increment: 1 },
    likes: { decrement: 1 },
    score: { multiply: 2 },
    rating: { divide: 2 },
    version: { set: 5 }
  }
})
```

### updateMany

Update multiple records:

```typescript
const result = await prisma.user.updateMany({
  where: { role: 'USER' },
  data: { verified: true }
})
// Returns { count: 42 }
```

### updateManyAndReturn

```typescript
const users = await prisma.user.updateManyAndReturn({
  where: { role: 'USER' },
  data: { verified: true }
})
// Returns array of updated users
```

### upsert

Update or create:

```typescript
const user = await prisma.user.upsert({
  where: { email: 'alice@prisma.io' },
  update: { name: 'Alice Smith' },
  create: { email: 'alice@prisma.io', name: 'Alice' }
})
```

## Delete Operations

### delete

Delete a single record:

```typescript
const user = await prisma.user.delete({
  where: { id: 1 }
})
// Returns deleted record
```

### deleteMany

Delete multiple records:

```typescript
const result = await prisma.user.deleteMany({
  where: { role: 'GUEST' }
})
// Returns { count: 5 }

// Delete all
const result = await prisma.user.deleteMany({})
```

## Aggregation Operations

### count

```typescript
const count = await prisma.user.count({
  where: { role: 'ADMIN' }
})
```

### aggregate

```typescript
const result = await prisma.post.aggregate({
  _avg: { views: true },
  _sum: { views: true },
  _min: { views: true },
  _max: { views: true },
  _count: { _all: true }
})
```

### groupBy

```typescript
const groups = await prisma.user.groupBy({
  by: ['country'],
  _count: { _all: true },
  _avg: { age: true },
  having: {
    age: { _avg: { gt: 30 } }
  }
})
```

## Return Types

| Method | Returns |
|--------|---------|
| `findUnique` | Record \| null |
| `findUniqueOrThrow` | Record (throws if not found) |
| `findFirst` | Record \| null |
| `findFirstOrThrow` | Record (throws if not found) |
| `findMany` | Record[] |
| `create` | Record |
| `createMany` | { count: number } |
| `createManyAndReturn` | Record[] |
| `update` | Record |
| `updateMany` | { count: number } |
| `delete` | Record |
| `deleteMany` | { count: number } |
| `count` | number |
| `aggregate` | Aggregate result |
| `groupBy` | Group result[] |
