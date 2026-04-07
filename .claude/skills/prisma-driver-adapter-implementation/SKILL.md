---
name: prisma-driver-adapter-implementation
description: Required reference for Prisma v7 driver adapter work. Use when implementing or modifying adapters, adding database drivers, or touching SqlDriverAdapter/Transaction interfaces. Contains critical contract details not inferable from code examples — including the transaction lifecycle protocol, error mapping requirements, and verification checklist. Existing implementations do not replace this skill.
license: MIT
metadata:
  author: Tyler Benfield
  version: "7.6.0"
---

# Prisma 7 Driver Adapter Implementation Guide

This skill provides everything needed to implement a Prisma ORM v7 driver adapter for any database.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         PrismaClient                            │
│                    (requires adapter factory)                   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│            SqlMigrationAwareDriverAdapterFactory                │
│   ┌─────────────────────┐    ┌─────────────────────────────┐    │
│   │ connect()           │    │ connectToShadowDb()         │    │
│   │ → SqlDriverAdapter  │    │ → SqlDriverAdapter          │    │
│   └─────────────────────┘    └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SqlDriverAdapter                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ queryRaw()   │ │ executeRaw() │ │ startTransaction()       │ │
│  │ → ResultSet  │ │ → number     │ │ → Transaction            │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │executeScript │ │ dispose()    │ │ getConnectionInfo()      │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Transaction                              │
│  Extends SqlQueryable + commit() + rollback() + options         │
│  (lifecycle hooks only — Prisma sends SQL via executeRaw)       │
└─────────────────────────────────────────────────────────────────┘
```

## Required Interfaces

Import from `@prisma/driver-adapter-utils`:

```typescript
import type {
  ColumnType,
  IsolationLevel,
  SqlDriverAdapter,
  SqlMigrationAwareDriverAdapterFactory,
  SqlQuery,
  SqlQueryable,
  SqlResultSet,
  Transaction,
  TransactionOptions,
  ArgType,
  ConnectionInfo,
  MappedError,
} from "@prisma/driver-adapter-utils";
import {
  ColumnTypeEnum,
  DriverAdapterError,
} from "@prisma/driver-adapter-utils";
```

## Interface Definitions

### SqlQuery (input to queryRaw/executeRaw)

```typescript
type SqlQuery = {
  sql: string; // Parameterized SQL with placeholders
  args: Array<unknown>; // Bound parameter values
  argTypes: Array<ArgType>; // Type hints for each argument
};

type ArgType = {
  scalarType: ArgScalarType; // 'string' | 'int' | 'bigint' | 'float' | 'decimal' | 'boolean' | 'enum' | 'uuid' | 'json' | 'datetime' | 'bytes' | 'unknown'
  dbType?: string;
  arity: "scalar" | "list";
};
```

### SqlResultSet (output from queryRaw)

```typescript
interface SqlResultSet {
  columnNames: Array<string>; // Column names in order
  columnTypes: Array<ColumnType>; // Column types matching columnNames
  rows: Array<Array<unknown>>; // Row data as arrays
  lastInsertId?: string; // For INSERT without RETURNING
}
```

### ColumnTypeEnum values

```typescript
const ColumnTypeEnum = {
  Int32: 0,
  Int64: 1,
  Float: 2,
  Double: 3,
  Numeric: 4,
  Boolean: 5,
  Character: 6,
  Text: 7,
  Date: 8,
  Time: 9,
  DateTime: 10,
  Json: 11,
  Enum: 12,
  Bytes: 13,
  Set: 14,
  Uuid: 15,
  Int32Array: 64,
  Int64Array: 65,
  FloatArray: 66,
  DoubleArray: 67,
  NumericArray: 68,
  BooleanArray: 69,
  CharacterArray: 70,
  TextArray: 71,
  DateArray: 72,
  TimeArray: 73,
  DateTimeArray: 74,
  JsonArray: 75,
  EnumArray: 76,
  BytesArray: 77,
  UuidArray: 78,
  UnknownNumber: 128,
} as const;
```

### SqlDriverAdapter

```typescript
interface SqlDriverAdapter extends SqlQueryable {
  executeScript(script: string): Promise<void>;
  startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction>;
  getConnectionInfo?(): ConnectionInfo;
  dispose(): Promise<void>;
}
```

### Transaction

```typescript
interface Transaction extends SqlQueryable {
  readonly options: TransactionOptions;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

type TransactionOptions = { usePhantomQuery: boolean };
```

### SqlMigrationAwareDriverAdapterFactory

```typescript
interface SqlMigrationAwareDriverAdapterFactory {
  readonly provider: "mysql" | "postgres" | "sqlite" | "sqlserver";
  readonly adapterName: string;
  connect(): Promise<SqlDriverAdapter>;
  connectToShadowDb(): Promise<SqlDriverAdapter>;
}
```

## Implementation Steps

### Step 1: Create the Queryable base class

```typescript
class MyQueryable<TClient> implements SqlQueryable {
  readonly provider = "postgres" as const; // or 'sqlite' | 'mysql' | 'sqlserver'
  readonly adapterName = "@my-org/adapter-mydb" as const;

  constructor(protected readonly client: TClient) {}

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    try {
      const args = query.args.map((arg, i) =>
        mapArg(arg, query.argTypes[i] ?? { scalarType: "unknown", arity: "scalar" })
      );

      // Execute query with your driver
      const result = await this.client.query(query.sql, args);

      // Extract column metadata
      const columnNames = /* get from result */;
      const columnTypes = /* map to ColumnTypeEnum */;

      // Map rows to ResultValue arrays
      const rows = result.map(row => mapRow(row, columnTypes));

      return { columnNames, columnTypes, rows };
    } catch (e) {
      this.onError(e);
    }
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    try {
      const args = query.args.map((arg, i) =>
        mapArg(arg, query.argTypes[i] ?? { scalarType: "unknown", arity: "scalar" })
      );
      const result = await this.client.query(query.sql, args);
      return result.affectedRows ?? 0;
    } catch (e) {
      this.onError(e);
    }
  }

  protected onError(error: unknown): never {
    throw new DriverAdapterError(convertDriverError(error));
  }
}
```

### Step 2: Create the Transaction class

**Critical**: `commit()` and `rollback()` are **lifecycle hooks only**. They must NOT issue SQL. Prisma sends `COMMIT`/`ROLLBACK` via `executeRaw` on the transaction object.

```typescript
class MyTransaction extends MyQueryable<TClient> implements Transaction {
  readonly options: TransactionOptions;
  readonly #release: () => void;

  constructor(
    client: TClient,
    options: TransactionOptions,
    release: () => void,
  ) {
    super(client);
    this.options = options;
    this.#release = release;
  }

  commit(): Promise<void> {
    // DO NOT issue COMMIT SQL here — Prisma does it via executeRaw
    this.#release(); // Release connection/resources
    return Promise.resolve();
  }

  rollback(): Promise<void> {
    // DO NOT issue ROLLBACK SQL here — Prisma does it via executeRaw
    this.#release();
    return Promise.resolve();
  }
}
```

### Step 3: Create the Adapter class

```typescript
class MyAdapter extends MyQueryable<TClient> implements SqlDriverAdapter {
  #transactionDepth = 0;

  constructor(client: TClient) {
    super(client);
  }

  async executeScript(script: string): Promise<void> {
    // For SQLite: split on ';' and run each statement
    // For Postgres: use multi-statement execution
    try {
      // Implementation depends on driver capabilities
    } catch (e) {
      this.onError(e);
    }
  }

  async startTransaction(
    isolationLevel?: IsolationLevel,
  ): Promise<Transaction> {
    // Validate isolation level for your database
    const validLevels = new Set<IsolationLevel>([
      "READ UNCOMMITTED",
      "READ COMMITTED",
      "REPEATABLE READ",
      "SERIALIZABLE",
    ]);

    if (isolationLevel !== undefined && !validLevels.has(isolationLevel)) {
      throw new DriverAdapterError({
        kind: "InvalidIsolationLevel",
        level: isolationLevel,
      });
    }

    const options: TransactionOptions = { usePhantomQuery: false };

    this.#transactionDepth += 1;
    const depth = this.#transactionDepth;

    try {
      if (depth === 1) {
        // Issue BEGIN (with isolation level if specified)
        const beginSql = isolationLevel
          ? `BEGIN ISOLATION LEVEL ${isolationLevel}`
          : "BEGIN";
        await this.client.query(beginSql);
      } else {
        // Nested: use savepoints
        await this.client.query(`SAVEPOINT sp_${depth}`);
      }
    } catch (e) {
      this.#transactionDepth -= 1;
      this.onError(e);
    }

    const release = () => {
      this.#transactionDepth -= 1;
    };
    return new MyTransaction(this.client, options, release);
  }

  getConnectionInfo(): ConnectionInfo {
    return { supportsRelationJoins: true };
  }

  async dispose(): Promise<void> {
    await this.client.close();
  }
}
```

### Step 4: Create the Factory class

```typescript
export type MyAdapterConfig = {
  url: string;
};

export type MyAdapterOptions = {
  shadowDatabaseUrl?: string;
};

export class MyAdapterFactory implements SqlMigrationAwareDriverAdapterFactory {
  readonly provider = "postgres" as const;
  readonly adapterName = "@my-org/adapter-mydb" as const;

  constructor(
    private readonly config: MyAdapterConfig,
    private readonly options?: MyAdapterOptions,
  ) {}

  connect(): Promise<SqlDriverAdapter> {
    return Promise.resolve(new MyAdapter(openConnection(this.config.url)));
  }

  connectToShadowDb(): Promise<SqlDriverAdapter> {
    const url = this.options?.shadowDatabaseUrl ?? this.config.url;
    return Promise.resolve(new MyAdapter(openConnection(url)));
  }
}
```

## Conversion Helpers

### Argument Mapping (input)

Convert Prisma argument values to driver-native types:

```typescript
function mapArg(arg: unknown, argType: ArgType): unknown {
  if (arg === null || arg === undefined) return null;

  // String → number for int columns
  if (typeof arg === "string" && argType.scalarType === "int")
    return Number.parseInt(arg, 10);

  // String → number for float columns
  if (typeof arg === "string" && argType.scalarType === "float")
    return Number.parseFloat(arg);

  // String → BigInt for bigint columns
  if (typeof arg === "string" && argType.scalarType === "bigint")
    return BigInt(arg);

  // Base64 string → Buffer for bytes columns
  if (typeof arg === "string" && argType.scalarType === "bytes")
    return Buffer.from(arg, "base64");

  // Boolean → 0/1 for SQLite
  if (typeof arg === "boolean" && /* SQLite */)
    return arg ? 1 : 0;

  return arg;
}
```

### Row Mapping (output)

Convert driver result values to Prisma-expected types:

```typescript
function mapRow(row: unknown[], columnTypes: ColumnType[]): ResultValue[] {
  const result: ResultValue[] = [];

  for (let i = 0; i < row.length; i++) {
    const value = row[i] ?? null;
    const colType = columnTypes[i];

    if (value === null) {
      result.push(null);
      continue;
    }

    // bigint → string for Int64 (JSON-safe)
    if (typeof value === "bigint") {
      result.push(value.toString());
      continue;
    }

    // Date → ISO 8601 string for DateTime
    if (value instanceof Date) {
      result.push(value.toISOString());
      continue;
    }

    // JSON objects → stringified
    if (colType === ColumnTypeEnum.Json && typeof value === "object") {
      result.push(JSON.stringify(value));
      continue;
    }

    result.push(value as ResultValue);
  }

  return result;
}
```

### Column Type Inference

When the driver doesn't provide type metadata, infer from JS values:

```typescript
function inferColumnType(value: NonNullable<unknown>): ColumnType {
  if (typeof value === "boolean") return ColumnTypeEnum.Boolean;
  if (typeof value === "bigint") return ColumnTypeEnum.Int64;
  if (value instanceof Uint8Array) return ColumnTypeEnum.Bytes;
  if (value instanceof Date) return ColumnTypeEnum.DateTime;
  if (Array.isArray(value)) return ColumnTypeEnum.Text; // fallback
  if (typeof value === "object") return ColumnTypeEnum.Json;
  if (typeof value === "number") return ColumnTypeEnum.UnknownNumber;
  return ColumnTypeEnum.Text;
}
```

## Error Handling

Map driver errors to `MappedError` for Prisma to handle correctly:

```typescript
function convertDriverError(error: unknown): MappedError {
  if (error instanceof Error) {
    // Database-specific error mapping
    const dbError = error as Error & { code?: string; errno?: number };

    // PostgreSQL example
    if (dbError.code === "23505") {
      return { kind: "UniqueConstraintViolation" };
    }
    if (dbError.code === "23502") {
      return { kind: "NullConstraintViolation" };
    }
    if (dbError.code === "23503") {
      return { kind: "ForeignKeyConstraintViolation" };
    }
    if (dbError.code === "42P01") {
      return { kind: "TableDoesNotExist" };
    }

    // SQLite example
    if (error.name === "SQLiteError") {
      return {
        kind: "sqlite",
        extendedCode: dbError.errno ?? 1,
        message: error.message,
      };
    }

    // PostgreSQL raw error
    if (dbError.code) {
      return {
        kind: "postgres",
        code: dbError.code,
        severity: "ERROR",
        message: error.message,
        detail: undefined,
        column: undefined,
        hint: undefined,
      };
    }
  }

  return { kind: "GenericJs", id: 0 };
}
```

## Database-Specific Notes

### SQLite

- Set `safeIntegers: true` when opening the database to get `bigint` for large integers
- Only `SERIALIZABLE` isolation level is valid
- `executeScript`: split on `;` and run each statement individually
- Boolean values: store as 0/1, return as boolean

### PostgreSQL

- All standard isolation levels are valid
- For connection pooling (PgBouncer), use `prepare: false`
- Transactions require a dedicated connection (`reserve()` pattern)
- `executeScript`: use multi-statement execution (`.simple()` in some drivers)
- `int8` columns may return as string (already stringified by driver)
- `numeric` columns return as string to preserve precision

### MySQL/MariaDB

- Supports `READ UNCOMMITTED`, `READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE`
- Use `?` placeholders for parameters
- Handle `BIGINT` as string for large values

## Testing Strategy

### Unit Tests (no PrismaClient)

Test the adapter directly with the raw database driver:

```typescript
describe("queryRaw", () => {
  test("returns column names and types", async () => {
    const adapter = new MyAdapter(createTestConnection());
    const result = await adapter.queryRaw({
      sql: "SELECT id, name FROM users",
      args: [],
      argTypes: [],
    });
    expect(result.columnNames).toEqual(["id", "name"]);
    expect(result.columnTypes[0]).toBe(ColumnTypeEnum.Int32);
  });
});

describe("startTransaction", () => {
  test("commit persists changes", async () => {
    const adapter = new MyAdapter(createTestConnection());
    const tx = await adapter.startTransaction();
    await tx.executeRaw({
      sql: "INSERT INTO users (name) VALUES (?)",
      args: ["Alice"],
      argTypes: [],
    });
    // Prisma sends COMMIT via executeRaw
    await tx.executeRaw({ sql: "COMMIT", args: [], argTypes: [] });
    await tx.commit(); // lifecycle hook only
    // Verify data persisted
  });
});
```

### E2E Tests (with PrismaClient)

Test the full integration:

```typescript
describe("E2E", () => {
  let prisma: PrismaClient;

  beforeEach(async () => {
    const factory = new MyAdapterFactory({ url: TEST_DB_URL });
    prisma = new PrismaClient({ adapter: factory });
  });

  test("CRUD operations", async () => {
    const user = await prisma.user.create({ data: { name: "Alice" } });
    expect(user.id).toBeGreaterThan(0);

    const found = await prisma.user.findUnique({ where: { id: user.id } });
    expect(found?.name).toBe("Alice");
  });

  test("transactions roll back on error", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { name: "Bob" } });
        throw new Error("Rollback!");
      }),
    ).rejects.toThrow();

    expect(await prisma.user.count()).toBe(0);
  });
});
```

## Usage Example

```typescript
import { PrismaClient } from "./generated/prisma/client";
import { MyAdapterFactory } from "@my-org/adapter-mydb";

const factory = new MyAdapterFactory({
  url: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter: factory });

// Use prisma normally
const users = await prisma.user.findMany();
```

## Checklist

Before considering the adapter complete:

- [ ] `SqlMigrationAwareDriverAdapterFactory` implemented with `connect()` and `connectToShadowDb()`
- [ ] `SqlDriverAdapter` implements `queryRaw`, `executeRaw`, `executeScript`, `startTransaction`, `dispose`
- [ ] `Transaction` implements `queryRaw`, `executeRaw`, `commit`, `rollback` with `options: { usePhantomQuery: false }`
- [ ] `commit()` and `rollback()` are lifecycle hooks only (no SQL issued)
- [ ] `startTransaction` issues `BEGIN` (depth 1) or `SAVEPOINT sp_N` (nested)
- [ ] Argument mapping handles: string→int, string→bigint, string→float, base64→bytes
- [ ] Row mapping handles: bigint→string, Date→ISO string, JSON→string
- [ ] Column types correctly mapped to `ColumnTypeEnum`
- [ ] Errors wrapped in `DriverAdapterError` with proper `MappedError` kind
- [ ] Isolation level validation for the target database
- [ ] Unit tests pass for queryRaw, executeRaw, executeScript, transactions
- [ ] E2E tests pass with real PrismaClient
