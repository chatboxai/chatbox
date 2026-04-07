# Query Options

Options for controlling query behavior.

## select

Choose specific fields to return:

```typescript
const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: {
    id: true,
    name: true,
    email: true,
    // password: false (excluded by not including)
  }
})
// Returns: { id: 1, name: 'Alice', email: 'alice@prisma.io' }
```

### Select relations

```typescript
const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: {
    name: true,
    posts: {
      select: {
        title: true,
        published: true
      }
    }
  }
})
```

### Select with include inside

```typescript
const user = await prisma.user.findMany({
  select: {
    name: true,
    posts: {
      include: {
        comments: true
      }
    }
  }
})
```

### Select relation count

```typescript
const users = await prisma.user.findMany({
  select: {
    name: true,
    _count: {
      select: { posts: true }
    }
  }
})
// Returns: { name: 'Alice', _count: { posts: 5 } }
```

## include

Include related records:

```typescript
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: {
    posts: true,
    profile: true
  }
})
```

### Filtered include

```typescript
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: {
    posts: {
      where: { published: true },
      orderBy: { createdAt: 'desc' },
      take: 5
    }
  }
})
```

### Nested include

```typescript
const user = await prisma.user.findUnique({
  where: { id: 1 },
  include: {
    posts: {
      include: {
        comments: {
          include: {
            author: true
          }
        }
      }
    }
  }
})
```

### Include relation count

```typescript
const users = await prisma.user.findMany({
  include: {
    _count: {
      select: { posts: true, followers: true }
    }
  }
})
```

## omit

Exclude specific fields:

```typescript
const user = await prisma.user.findUnique({
  where: { id: 1 },
  omit: {
    password: true
  }
})
// Returns all fields except password
```

### Omit in relations

```typescript
const users = await prisma.user.findMany({
  omit: { password: true },
  include: {
    posts: {
      omit: { content: true }
    }
  }
})
```

**Note:** Cannot use `select` and `omit` together.

## where

Filter records:

```typescript
const users = await prisma.user.findMany({
  where: {
    email: { contains: '@prisma.io' },
    role: 'ADMIN'
  }
})
```

See `filters.md` for detailed filter operators.

## orderBy

Sort results:

```typescript
// Single field
const users = await prisma.user.findMany({
  orderBy: { name: 'asc' }
})

// Multiple fields
const users = await prisma.user.findMany({
  orderBy: [
    { role: 'desc' },
    { name: 'asc' }
  ]
})
```

### Order by relation

```typescript
const users = await prisma.user.findMany({
  orderBy: {
    posts: { _count: 'desc' }
  }
})
```

### Null handling

```typescript
const users = await prisma.user.findMany({
  orderBy: {
    name: { sort: 'asc', nulls: 'last' }
  }
})
```

## take & skip

Pagination:

```typescript
// First page
const users = await prisma.user.findMany({
  take: 10,
  skip: 0
})

// Second page
const users = await prisma.user.findMany({
  take: 10,
  skip: 10
})
```

### Negative take (reverse)

```typescript
const lastUsers = await prisma.user.findMany({
  take: -10,
  orderBy: { id: 'asc' }
})
// Returns last 10 users
```

## cursor

Cursor-based pagination:

```typescript
// First page
const firstPage = await prisma.user.findMany({
  take: 10,
  orderBy: { id: 'asc' }
})

// Next page using cursor
const nextPage = await prisma.user.findMany({
  take: 10,
  skip: 1,  // Skip the cursor record
  cursor: { id: firstPage[firstPage.length - 1].id },
  orderBy: { id: 'asc' }
})
```

## distinct

Return unique values:

```typescript
const cities = await prisma.user.findMany({
  distinct: ['city'],
  select: { city: true }
})
```

### Multiple distinct fields

```typescript
const locations = await prisma.user.findMany({
  distinct: ['city', 'country']
})
```
