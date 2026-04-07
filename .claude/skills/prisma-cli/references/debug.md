# prisma debug

Prints information helpful for debugging and bug reports.

## Command

```bash
prisma debug [options]
```

## What It Does

Outputs details about your Prisma environment, including:
- Prisma CLI version
- Prisma Client version (if installed)
- Engine binaries (Query Engine, Migration Engine, etc.)
- Platform information (OS, Architecture)
- Node.js version
- Configured datasource provider

## Options

| Option | Description |
|--------|-------------|
| `--schema` | Path to schema file |
| `--config` | Custom path to your Prisma config file |

## Example Output

```
prisma               : 7.3.0
@prisma/client       : 7.3.0
Operating System     : darwin
Architecture         : arm64
Node.js              : v20.10.0
TypeScript           : 5.3.3
Query Compiler       : enabled
PSL                  : ...
Schema Engine        : ...
```

## When to Use

- **Troubleshooting**: Checking version mismatches
- **Reporting Issues**: Including environment info in GitHub issues
- **Verifying Installation**: Ensuring correct binaries are downloaded
