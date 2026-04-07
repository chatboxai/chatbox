# management-api-sdk

Use `@prisma/management-api-sdk` for typed API integration with optional OAuth and token refresh.

## Priority

HIGH

## Why It Matters

The SDK provides typed endpoint methods and removes boilerplate around auth and refresh handling, which reduces errors in production provisioning flows.

## Install

```bash
npm install @prisma/management-api-sdk
```

## Simple client (existing token)

```typescript
import { createManagementApiClient } from '@prisma/management-api-sdk'

const client = createManagementApiClient({ token: process.env.PRISMA_SERVICE_TOKEN! })
const { data: workspaces } = await client.GET('/v1/workspaces')
```

## Full SDK (OAuth + refresh)

```typescript
import { createManagementApiSdk, type TokenStorage } from '@prisma/management-api-sdk'

const tokenStorage: TokenStorage = {
  async getTokens() { return null },
  async setTokens(tokens) {},
  async clearTokens() {},
}

const api = createManagementApiSdk({
  clientId: process.env.PRISMA_CLIENT_ID!,
  redirectUri: 'https://your-app.com/auth/callback',
  tokenStorage,
})
```

## OAuth SDK flow

1. Call `getLoginUrl()` and persist `state` + `verifier`.
2. Redirect user to login URL.
3. Handle callback with `handleCallback()`.
4. Use `api.client` for typed endpoint calls.
5. Call `logout()` when needed.

## References

- [Management API SDK docs](https://www.prisma.io/docs/postgres/introduction/management-api-sdk)
