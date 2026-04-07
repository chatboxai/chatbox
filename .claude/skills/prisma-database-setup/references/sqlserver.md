# SQL Server Setup

Configure Prisma with Microsoft SQL Server.

## Prerequisites

- SQL Server 2017, 2019, 2022, or Azure SQL
- TCP/IP enabled

## 1. Schema Configuration

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "sqlserver"
}

generator client {
  provider = "prisma-client"
  output   = "../generated"
}
```

## 2. Config Configuration

In `prisma.config.ts`:

```typescript
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

## 3. Environment Variable

In `.env`:

```env
DATABASE_URL="sqlserver://localhost:1433;database=mydb;user=sa;password=Password123;encrypt=true;trustServerCertificate=true"
```

### Connection String Format

```
sqlserver://HOST:PORT;database=DB;user=USER;password=PASS;encrypt=true;trustServerCertificate=true
```

- **encrypt**: Required for Azure (true).
- **trustServerCertificate**: True for self-signed certs (local dev).

## Driver Adapter

Use a driver adapter for the standard SQL workflow.

1. Install adapter and driver:
   ```bash
   npm install @prisma/adapter-mssql mssql
   ```

2. Instantiate Prisma Client with the adapter:
   ```typescript
   import 'dotenv/config'
   import { PrismaClient } from '../generated/client'
   import { PrismaMssql } from '@prisma/adapter-mssql'

   const adapter = new PrismaMssql({
     server: 'localhost',
     port: 1433,
     database: 'mydb',
     user: process.env.SQLSERVER_USER,
     password: process.env.SQLSERVER_PASSWORD,
     options: {
       encrypt: true,
       trustServerCertificate: true,
     },
   })

   const prisma = new PrismaClient({ adapter })
   ```

## Common Issues

### "Login failed for user"
- SQL Server auth vs Windows auth. Prisma typically uses SQL Server authentication (username/password).
- Ensure TCP/IP is enabled in SQL Server Configuration Manager.

### "Table not found" (dbo schema)
Prisma assumes `dbo` schema by default. If using another schema, update the model or connection string? SQL Server provider mostly sticks to default schema.
