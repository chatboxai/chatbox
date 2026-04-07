# management-api

Use Prisma Management API for programmatic provisioning and workspace/project/database management.

## Priority

CRITICAL

## Why It Matters

When you need backend automation, multi-tenant onboarding flows, or controlled resource provisioning, the Management API is the source of truth and is more reliable than interactive workflows.

## Base URL

```text
https://api.prisma.io/v1
```

## API exploration

- OpenAPI docs: `https://api.prisma.io/v1/doc`
- Swagger Editor: `https://api.prisma.io/v1/swagger-editor`

## Authentication methods

- Service token: best for server-to-server operations in your own workspace
- OAuth 2.0: best for acting on behalf of users across workspaces

## Service token flow

1. Create token in Prisma Console workspace settings.
2. Send token as Bearer auth:

```text
Authorization: Bearer $TOKEN
```

## OAuth flow summary

1. Redirect user to `https://auth.prisma.io/authorize` with `client_id`, `redirect_uri`, `response_type=code`, and scopes.
2. Receive `code` on callback.
3. Exchange code at `https://auth.prisma.io/token`.
4. Use returned access token in Management API requests.

## Common endpoints

- `GET /workspaces`
- `GET /projects`
- `POST /projects`
- Database management endpoints under project/database paths

## Notes

- Management API responses may include direct connection credentials for databases.
- Build PostgreSQL `DATABASE_URL` from direct connection values when needed.

## References

- [Management API docs](https://www.prisma.io/docs/postgres/introduction/management-api)
- [OpenAPI docs](https://api.prisma.io/v1/doc)
- [Swagger Editor](https://api.prisma.io/v1/swagger-editor)
