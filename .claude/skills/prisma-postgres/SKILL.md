---
name: prisma-postgres
description: Prisma Postgres setup and operations guidance across Console, create-db CLI, Management API, and Management API SDK. Use when creating Prisma Postgres databases, working in Prisma Console, provisioning with create-db/create-pg/create-postgres, or integrating programmatic provisioning with service tokens or OAuth.
license: MIT
metadata:
  author: prisma
  version: "7.6.0"
---

# Prisma Postgres

Guidance for creating, managing, and integrating Prisma Postgres across interactive and programmatic workflows.

## When to Apply

Reference this skill when:
- Setting up Prisma Postgres from Prisma Console
- Provisioning instant temporary databases with `create-db`
- Linking an existing local project with `prisma postgres link`
- Managing Prisma Postgres resources via Management API
- Using `@prisma/management-api-sdk` in TypeScript/JavaScript
- Handling claim URLs, connection strings, regions, and auth flows

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | CLI Provisioning | CRITICAL | `create-db-cli` |
| 2 | Management API | CRITICAL | `management-api` |
| 3 | Management API SDK | HIGH | `management-api-sdk` |
| 4 | Console and Connections | HIGH | `console-and-connections` |

## Quick Reference

- `create-db-cli` - instant databases and current CLI flags (`--ttl`, `--copy`, `--quiet`, `--open`)
- `management-api` - service token and OAuth API workflows
- `management-api-sdk` - typed SDK usage with token storage
- `console-and-connections` - Console operations, `prisma postgres link`, direct TCP connections, and serverless-driver choices

## Core Workflows

### 1. Console-first workflow

Use Prisma Console for manual setup and operations:

- Open `https://console.prisma.io`
- Create/select workspace and project
- Use Studio in the project sidebar to view/edit data
- Retrieve direct connection details from the project UI

### 2. Quick provisioning with create-db

Use `create-db` when you need a database immediately:

```bash
npx create-db@latest
```

Aliases:

```bash
npx create-pg@latest
npx create-postgres@latest
```

For app integrations, you can also use the programmatic API (`create()` / `regions()`) from the `create-db` npm package.

Temporary databases auto-delete after ~24 hours unless claimed.

### 3. Link an existing local project

Use `prisma postgres link` when the database already exists and you want to wire a local project to it:

```bash
prisma postgres link
```

For CI or other non-interactive environments:

```bash
prisma postgres link --api-key "<your-api-key>" --database "db_..."
```

This flow updates your local `.env` with `DATABASE_URL`, then you can run `prisma generate` and `prisma migrate dev`.

### 4. Programmatic provisioning with Management API

Use API endpoints on:

```text
https://api.prisma.io/v1
```

Explore the schema and endpoints using:

- OpenAPI docs: `https://api.prisma.io/v1/doc`
- Swagger Editor: `https://api.prisma.io/v1/swagger-editor`

Auth options:

- Service token (workspace server-to-server)
- OAuth 2.0 (act on behalf of users)

### 5. Type-safe integration with Management API SDK

Install and use:

```bash
npm install @prisma/management-api-sdk
```

Use `createManagementApiClient` for existing tokens, or `createManagementApiSdk` for OAuth + token refresh.

## Rule Files

Detailed guidance lives in:

```
references/console-and-connections.md
references/create-db-cli.md
references/management-api.md
references/management-api-sdk.md
```

## How to Use

Start with `references/create-db-cli.md` for fast setup, then switch to `references/management-api.md` or `references/management-api-sdk.md` when you need programmatic provisioning.
