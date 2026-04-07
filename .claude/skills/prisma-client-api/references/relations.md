# Relation Queries

Query and modify related records.

## Include Relations

Load related records:

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
      take: 5,
      select: { id: true, title: true }
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
          include: { author: true }
        }
      }
    }
  }
})
```

## Select Relations

```typescript
const user = await prisma.user.findUnique({
  where: { id: 1 },
  select: {
    name: true,
    posts: {
      select: { title: true }
    }
  }
})
```

## Nested Writes

### Create with relations

```typescript
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

### Create or connect

```typescript
const post = await prisma.post.create({
  data: {
    title: 'New Post',
    author: {
      connectOrCreate: {
        where: { email: 'alice@prisma.io' },
        create: { email: 'alice@prisma.io', name: 'Alice' }
      }
    }
  }
})
```

### Connect existing

```typescript
const post = await prisma.post.create({
  data: {
    title: 'New Post',
    author: {
      connect: { id: 1 }
    }
  }
})

// Shorthand for foreign key
const post = await prisma.post.create({
  data: {
    title: 'New Post',
    authorId: 1
  }
})
```

## Update Relations

### Update related records

```typescript
const user = await prisma.user.update({
  where: { id: 1 },
  data: {
    posts: {
      update: {
        where: { id: 1 },
        data: { title: 'Updated Title' }
      }
    }
  }
})
```

### Update many related

```typescript
const user = await prisma.user.update({
  where: { id: 1 },
  data: {
    posts: {
      updateMany: {
        where: { published: false },
        data: { published: true }
      }
    }
  }
})
```

### Upsert related

```typescript
const user = await prisma.user.update({
  where: { id: 1 },
  data: {
    profile: {
      upsert: {
        create: { bio: 'New bio' },
        update: { bio: 'Updated bio' }
      }
    }
  }
})
```

### Disconnect

```typescript
// 1-to-1 optional
const user = await prisma.user.update({
  where: { id: 1 },
  data: {
    profile: { disconnect: true }
  }
})

// Many-to-many
const post = await prisma.post.update({
  where: { id: 1 },
  data: {
    tags: {
      disconnect: [{ id: 1 }, { id: 2 }]
    }
  }
})
```

### Delete related

```typescript
const user = await prisma.user.update({
  where: { id: 1 },
  data: {
    posts: {
      delete: { id: 1 }
    }
  }
})

// Delete many
const user = await prisma.user.update({
  where: { id: 1 },
  data: {
    posts: {
      deleteMany: { published: false }
    }
  }
})
```

### Set (replace all)

```typescript
// Replace all related records
const post = await prisma.post.update({
  where: { id: 1 },
  data: {
    tags: {
      set: [{ id: 1 }, { id: 2 }]
    }
  }
})
```

## Relation Filters

### some

At least one matches:

```typescript
const users = await prisma.user.findMany({
  where: {
    posts: { some: { published: true } }
  }
})
```

### every

All match:

```typescript
const users = await prisma.user.findMany({
  where: {
    posts: { every: { published: true } }
  }
})
```

### none

None match:

```typescript
const users = await prisma.user.findMany({
  where: {
    posts: { none: { published: true } }
  }
})
```

### is / isNot (1-to-1)

```typescript
const users = await prisma.user.findMany({
  where: {
    profile: { is: { country: 'USA' } }
  }
})
```

## Count Relations

```typescript
const users = await prisma.user.findMany({
  select: {
    name: true,
    _count: {
      select: { posts: true, followers: true }
    }
  }
})
// { name: 'Alice', _count: { posts: 5, followers: 100 } }
```

### Filter counted relations

```typescript
const users = await prisma.user.findMany({
  select: {
    name: true,
    _count: {
      select: {
        posts: { where: { published: true } }
      }
    }
  }
})
```
