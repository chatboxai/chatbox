# prisma validate

Validates your Prisma schema file.

## Command

```bash
prisma validate [options]
```

## What It Does

- Parses the `schema.prisma` file
- Checks for syntax errors
- Validates model definitions, relations, and types
- Reports any errors or warnings without generating code

## Options

| Option | Description |
|--------|-------------|
| `--schema` | Path to schema file |
| `--config` | Custom path to your Prisma config file |

## Examples

### Validate default schema

```bash
prisma validate
```

### Validate specific schema

```bash
prisma validate --schema=./custom/schema.prisma
```

### Use in CI

Run `validate` in your CI pipeline to catch schema errors early:

```yaml
- name: Validate Schema
  run: npx prisma validate
```

## Common Errors

- Missing `@relation` fields
- Invalid types
- Duplicate model names
- Syntax errors (missing braces, etc.)
