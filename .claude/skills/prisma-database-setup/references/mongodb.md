# MongoDB Setup

MongoDB projects should stay on the latest Prisma 6.x release. Do not upgrade a MongoDB app to Prisma 7's SQL client path.

## Prerequisites

- MongoDB 4.2+
- Replica Set configured (required for transactions)
- Latest Prisma 6.x release, or your team's pinned Prisma 6 version
- Node.js 20.19.0+
- TypeScript 5.4.0+

## 1. Schema Configuration

Use the standard Prisma 6 MongoDB setup with `prisma-client-js`.

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}
```

### Driver Adapters

Do **not** apply the Prisma 7 SQL adapter setup here. MongoDB does not use a SQL `@prisma/adapter-*` package.

### ID Field Requirement

MongoDB models **must** have a mapped `_id` field using `@id` and `@map("_id")`, usually of type `String` with `auto()` and `db.ObjectId`.

```prisma
model User {
  id    String @id @default(auto()) @map("_id") @db.ObjectId
  email String @unique
  name  String?
}
```

### Relations

Relations in MongoDB expect IDs to be `db.ObjectId` type.

```prisma
model Post {
  id       String @id @default(auto()) @map("_id") @db.ObjectId
  author   User   @relation(fields: [authorId], references: [id])
  authorId String @db.ObjectId
}
```

## 2. Environment Variable

In `.env`:

```env
DATABASE_URL="mongodb+srv://user:password@cluster.mongodb.net/mydb?retryWrites=true&w=majority"
```

## Migrations vs Introspection

- **No Migrations**: MongoDB is schema-less. `prisma migrate` commands **do not work**.
- **db push**: Use `prisma db push` to sync indexes and constraints.
- **db pull**: Use `prisma db pull` to generate schema from existing data (sampling).

## Current Verification Notes

- `prisma init --datasource-provider mongodb` is still implemented in Prisma's CLI source.
- Prisma's upstream repo still contains MongoDB fixtures and tests.
- Local verification shows Prisma 7 can still recognize MongoDB inputs, but the generated client path does not provide a supported MongoDB upgrade path.
- Local verification shows Prisma 6.x works end to end with `prisma-client-js`, `prisma db push`, and `new PrismaClient()` against a MongoDB replica set.

## Version Guidance

- For MongoDB, stay on the latest available Prisma 6.x release.
- Treat Prisma 7 MongoDB migration attempts as unsupported until Prisma ships a real MongoDB upgrade path.

## Common Issues

### "Transactions not supported"
Ensure your MongoDB instance is a **Replica Set**. Standalone instances do not support transactions. Atlas clusters are replica sets by default.

### "Invalid ObjectID"
Ensure fields referencing IDs are decorated with `@db.ObjectId` if the target is an ObjectID.
