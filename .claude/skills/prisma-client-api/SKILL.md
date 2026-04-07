---
name: prisma-client-api
description: Prisma Client API reference covering model queries, filters, operators, and client methods. Use when writing database queries, using CRUD operations, filtering data, or configuring Prisma Client. Triggers on "prisma query", "findMany", "create", "update", "delete", "$transaction".
license: MIT
metadata:
  author: prisma
  version: "7.6.0"
---

# Prisma Client API Reference

Complete API reference for Prisma Client. This skill provides guidance on model queries, filtering, relations, and client methods for current Prisma projects.

## When to Apply

Reference this skill when:
- Writing database queries with Prisma Client
- Performing CRUD operations (create, read, update, delete)
- Filtering and sorting data
- Working with relations
- Using transactions
- Configuring client options

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Client Construction | HIGH | `constructor` |
| 2 | Model Queries | CRITICAL | `model-queries` |
| 3 | Query Shape | HIGH | `query-options` |
| 4 | Filtering | HIGH | `filters` |
| 5 | Relations | HIGH | `relations` |
| 6 | Transactions | CRITICAL | `transactions` |
| 7 | Raw SQL | CRITICAL | `raw-queries` |
| 8 | Client Methods | MEDIUM | `client-methods` |

## Quick Reference

- `constructor` - `PrismaClient` setup, adapter wiring, logging, and SQL commenter plugins
- `model-queries` - CRUD operations and bulk operations
- `query-options` - `select`, `include`, `omit`, sort, pagination
- `filters` - scalar and logical filter operators
- `relations` - relation reads and nested writes
- `transactions` - array and interactive transaction patterns
- `raw-queries` - `$queryRaw` and `$executeRaw` safety
- `client-methods` - lifecycle methods, extensions, and `satisfies` patterns for `prisma-client`

## Client Instantiation

```typescript
import { PrismaClient } from '../generated/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL
})

const prisma = new PrismaClient({ adapter })
```

## Model Query Methods

| Method | Description |
|--------|-------------|
| `findUnique()` | Find one record by unique field |
| `findUniqueOrThrow()` | Find one or throw error |
| `findFirst()` | Find first matching record |
| `findFirstOrThrow()` | Find first or throw error |
| `findMany()` | Find multiple records |
| `create()` | Create a new record |
| `createMany()` | Create multiple records |
| `createManyAndReturn()` | Create multiple and return them |
| `update()` | Update one record |
| `updateMany()` | Update multiple records |
| `updateManyAndReturn()` | Update multiple and return them |
| `upsert()` | Update or create record |
| `delete()` | Delete one record |
| `deleteMany()` | Delete multiple records |
| `count()` | Count matching records |
| `aggregate()` | Aggregate values (sum, avg, etc.) |
| `groupBy()` | Group and aggregate |

## Query Options

| Option | Description |
|--------|-------------|
| `where` | Filter conditions |
| `select` | Fields to include |
| `include` | Relations to load |
| `omit` | Fields to exclude |
| `orderBy` | Sort order |
| `take` | Limit results |
| `skip` | Skip results (pagination) |
| `cursor` | Cursor-based pagination |
| `distinct` | Unique values only |

## Client Methods

| Method | Description |
|--------|-------------|
| `$connect()` | Explicitly connect to database |
| `$disconnect()` | Disconnect from database |
| `$transaction()` | Execute transaction |
| `$queryRaw()` | Execute raw SQL query |
| `$executeRaw()` | Execute raw SQL command |
| `$on()` | Subscribe to events |
| `$extends()` | Add extensions |

## Quick Examples

### Find records

```typescript
// Find by unique field
const user = await prisma.user.findUnique({
  where: { email: 'alice@prisma.io' }
})

// Find with filter
const users = await prisma.user.findMany({
  where: { role: 'ADMIN' },
  orderBy: { createdAt: 'desc' },
  take: 10
})
```

### Create records

```typescript
const user = await prisma.user.create({
  data: {
    email: 'alice@prisma.io',
    name: 'Alice',
    posts: {
      create: { title: 'Hello World' }
    }
  },
  include: { posts: true }
})
```

### Update records

```typescript
const user = await prisma.user.update({
  where: { id: 1 },
  data: { name: 'Alice Smith' }
})
```

### Delete records

```typescript
await prisma.user.delete({
  where: { id: 1 }
})
```

### Transactions

```typescript
const [user, post] = await prisma.$transaction([
  prisma.user.create({ data: { email: 'alice@prisma.io' } }),
  prisma.post.create({ data: { title: 'Hello', authorId: 1 } })
])
```

## Rule Files

Detailed API documentation:

```
references/constructor.md        - PrismaClient constructor options
references/model-queries.md      - CRUD operations
references/query-options.md      - select, include, omit, where, orderBy
references/filters.md            - Filter conditions and operators
references/relations.md          - Relation queries and nested operations
references/transactions.md       - Transaction API
references/raw-queries.md        - $queryRaw, $executeRaw
references/client-methods.md     - $connect, $disconnect, $on, $extends
```

## Filter Operators

| Operator | Description |
|----------|-------------|
| `equals` | Exact match |
| `not` | Not equal |
| `in` | In array |
| `notIn` | Not in array |
| `lt`, `lte` | Less than |
| `gt`, `gte` | Greater than |
| `contains` | String contains |
| `startsWith` | String starts with |
| `endsWith` | String ends with |
| `mode` | Case sensitivity |

## Relation Filters

| Operator | Description |
|----------|-------------|
| `some` | At least one related record matches |
| `every` | All related records match |
| `none` | No related records match |
| `is` | Related record matches (1-to-1) |
| `isNot` | Related record doesn't match |

## Resources

- [Prisma Client API Reference](https://www.prisma.io/docs/orm/reference/prisma-client-reference)
- [CRUD Operations](https://www.prisma.io/docs/orm/prisma-client/queries/crud)
- [Filtering and Sorting](https://www.prisma.io/docs/orm/prisma-client/queries/filtering-and-sorting)

## How to Use

Pick the category from the table above, then open the matching reference file for implementation details and examples.
