# ESM and CommonJS Support

Prisma ORM v7 is ESM-first, but the `prisma-client` generator can target either ESM or CommonJS. Use ESM by default, and opt into CommonJS with `moduleFormat = "cjs"` if your project still needs it.

## ESM Projects

Add `"type": "module"` to `package.json` and use an ESM-compatible `tsconfig.json`:

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2023",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*", "prisma/**/*"]
}
```

## CommonJS Projects

If the rest of your app is still CommonJS, keep that setup and make the generated Prisma Client CommonJS too:

```json
{
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node",
    "target": "ES2022",
    "esModuleInterop": true
  }
}
```

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../generated/prisma"
  moduleFormat = "cjs"
}
```

## Generator Fields That Matter

- `moduleFormat`: `esm` or `cjs`
- `runtime`: `nodejs`, `bun`, `deno`, `workerd`, `vercel-edge`, `react-native`
- `generatedFileExtension`: `ts`, `mts`, or `cts`
- `importFileExtension`: `ts`, `mts`, `cts`, `js`, `mjs`, `cjs`, or empty

Example:

```prisma
generator client {
  provider               = "prisma-client"
  output                 = "../generated/prisma"
  runtime                = "nodejs"
  moduleFormat           = "esm"
  generatedFileExtension = "ts"
  importFileExtension    = "ts"
}
```

## Import Paths

### Server Code

```typescript
import { PrismaClient } from '../generated/prisma/client'
```

### Browser-Safe Types

```typescript
import { Prisma } from '../generated/prisma/browser'
import { Role } from '../generated/prisma/enums'
import type { UserModel } from '../generated/prisma/models/User'
```

## File Extensions

With `moduleResolution: "Node16"` or `"NodeNext"`, use `.js`/`.mjs`/`.cjs` extensions that match your emitted files.

With `moduleResolution: "bundler"`, bare relative imports are usually fine.

## Minimum Versions

| Requirement | Minimum Version |
|-------------|-----------------|
| Node.js | 20.19.0 |
| TypeScript | 5.4.0 |

## Framework Considerations

### Next.js

Next.js works well with the default ESM output. If you need generated types in client components, import them from `browser`, `models`, or `enums`, not from `client`.

### Bun

Bun loads `.env` files automatically, so ESM plus `env()` is the smoothest default. You can still choose `moduleFormat = "cjs"` if the rest of your project requires it.

## Troubleshooting

### "ERR_REQUIRE_ESM"

Your generated client is ESM, but your app is requiring it as CommonJS. Either switch the project to ESM or set `moduleFormat = "cjs"` and regenerate.

### "Cannot use import statement outside a module"

Your app is still being executed as CommonJS. Add `"type": "module"` or use `moduleFormat = "cjs"` instead.

### TypeScript compilation errors

Ensure `module`, `moduleResolution`, and your generator's `moduleFormat` agree with one another.
