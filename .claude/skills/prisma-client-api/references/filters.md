# Filter Conditions and Operators

Filter operators for the `where` clause.

## Equality

```typescript
// Exact match (implicit)
where: { email: 'alice@prisma.io' }

// Explicit equals
where: { email: { equals: 'alice@prisma.io' } }

// Not equal
where: { email: { not: 'alice@prisma.io' } }
```

## Comparison

```typescript
// Greater than
where: { age: { gt: 18 } }

// Greater than or equal
where: { age: { gte: 18 } }

// Less than
where: { age: { lt: 65 } }

// Less than or equal
where: { age: { lte: 65 } }

// Combined
where: { age: { gte: 18, lte: 65 } }
```

## Lists

```typescript
// In array
where: { role: { in: ['ADMIN', 'MODERATOR'] } }

// Not in array
where: { role: { notIn: ['GUEST', 'BANNED'] } }
```

## String Filters

```typescript
// Contains
where: { email: { contains: 'prisma' } }

// Starts with
where: { email: { startsWith: 'alice' } }

// Ends with
where: { email: { endsWith: '@prisma.io' } }

// Case-insensitive (default for some databases)
where: { 
  email: { 
    contains: 'PRISMA',
    mode: 'insensitive' 
  } 
}
```

## Null Checks

```typescript
// Is null
where: { deletedAt: null }

// Is not null
where: { deletedAt: { not: null } }

// Using isSet (for optional fields)
where: { middleName: { isSet: true } }
```

## Logical Operators

### AND (implicit)

```typescript
// Multiple conditions = AND
where: {
  email: { contains: '@prisma.io' },
  role: 'ADMIN'
}
```

### AND (explicit)

```typescript
where: {
  AND: [
    { email: { contains: '@prisma.io' } },
    { role: 'ADMIN' }
  ]
}
```

### OR

```typescript
where: {
  OR: [
    { email: { contains: '@gmail.com' } },
    { email: { contains: '@prisma.io' } }
  ]
}
```

### NOT

```typescript
where: {
  NOT: {
    role: 'GUEST'
  }
}

// Multiple NOT conditions
where: {
  NOT: [
    { role: 'GUEST' },
    { verified: false }
  ]
}
```

### Combined

```typescript
where: {
  AND: [
    { verified: true },
    {
      OR: [
        { role: 'ADMIN' },
        { role: 'MODERATOR' }
      ]
    }
  ],
  NOT: { deletedAt: { not: null } }
}
```

## Relation Filters

### some

At least one related record matches:

```typescript
// Users with at least one published post
where: {
  posts: {
    some: { published: true }
  }
}
```

### every

All related records match:

```typescript
// Users where all posts are published
where: {
  posts: {
    every: { published: true }
  }
}
```

### none

No related records match:

```typescript
// Users with no published posts
where: {
  posts: {
    none: { published: true }
  }
}
```

### is / isNot (1-to-1)

```typescript
// Users with profile in specific country
where: {
  profile: {
    is: { country: 'USA' }
  }
}

// Users without profile
where: {
  profile: {
    isNot: null
  }
}
```

## Array Field Filters

For fields like `String[]`:

```typescript
// Has element
where: { tags: { has: 'typescript' } }

// Has some elements
where: { tags: { hasSome: ['typescript', 'javascript'] } }

// Has every element
where: { tags: { hasEvery: ['typescript', 'prisma'] } }

// Is empty
where: { tags: { isEmpty: true } }
```

## JSON Filters

```typescript
// Path-based filter
where: {
  metadata: {
    path: ['settings', 'theme'],
    equals: 'dark'
  }
}

// String contains in JSON
where: {
  metadata: {
    path: ['bio'],
    string_contains: 'developer'
  }
}
```

## Full-Text Search

```typescript
// Requires @@fulltext index
where: {
  content: {
    search: 'prisma database'
  }
}
```
