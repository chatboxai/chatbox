# prisma migrate deploy

Applies pending migrations in production/staging environments.

## Command

```bash
prisma migrate deploy
```

## What It Does

- Applies all pending migrations from `prisma/migrations/`
- Updates `_prisma_migrations` table
- Does NOT generate new migrations
- Does NOT run seed scripts
- Safe for CI/CD and production

## Options

| Option | Description |
|--------|-------------|
| `--schema` | Custom path to your Prisma schema |
| `--config` | Custom path to your Prisma config file |

## When to Use

- Production deployments
- Staging environments  
- CI/CD pipelines
- Any non-development environment

## Examples

### Basic deployment

```bash
prisma migrate deploy
```

### In CI/CD pipeline

```yaml
# GitHub Actions example
- name: Apply migrations
  run: npx prisma migrate deploy
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### Docker deployment

```dockerfile
# Run migrations before starting app
CMD npx prisma migrate deploy && node dist/index.js
```

## Comparison with migrate dev

| Feature | migrate dev | migrate deploy |
|---------|-------------|----------------|
| Creates migrations | Yes | No |
| Applies migrations | Yes | Yes |
| Detects drift | Yes | No |
| Prompts for input | Yes | No |
| Uses shadow database | Yes | No |
| Safe for production | No | Yes |
| Resets on issues | Prompts | Fails |

## Production Workflow

1. **Development**: Create migrations locally
   ```bash
   prisma migrate dev --name add_feature
   ```

2. **Commit**: Include migration files in version control
   ```bash
   git add prisma/migrations
   git commit -m "Add feature migration"
   ```

3. **Deploy**: Apply in production
   ```bash
   prisma migrate deploy
   ```

## Error Handling

### Failed migration

If a migration fails, `migrate deploy` exits with error. The failed migration is marked as failed in `_prisma_migrations`.

To fix:
1. Resolve the issue (fix SQL, database state, etc.)
2. Mark as resolved: `prisma migrate resolve --applied <migration_name>`
3. Re-run: `prisma migrate deploy`

### Check status first

```bash
prisma migrate status
```

Shows pending and applied migrations before deploying.

## Configuration

Ensure `prisma.config.ts` has the production database URL:

```typescript
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

## Best Practices

1. Always run `migrate status` before `migrate deploy` in CI
2. Have a rollback plan (backup before migrations)
3. Test migrations in staging first
4. Never use `migrate dev` in production
