# prisma mcp

Starts Prisma's MCP server for AI development tools.

## Command

```bash
prisma mcp
```

## What It Does

- Starts a Model Context Protocol (MCP) server for your Prisma project
- Exposes Prisma schema and database context to compatible AI tools
- Helps AI assistants understand models, generate queries, and suggest migrations

## Usage

```bash
prisma mcp
```

## Typical Use Cases

- Connect Prisma to ChatGPT, Claude, or other MCP-aware tools
- Give an AI assistant access to your Prisma schema structure
- Help an agent propose queries, schema updates, and migration steps with project context

## Notes

- Run this from the project that contains your Prisma schema and `prisma.config.ts`
- The command is separate from Prisma Studio and does not open a browser UI
- The MCP server wraps Prisma CLI commands. For exact behavior of commands like `migrate dev` or `migrate reset`, follow the underlying CLI command docs rather than relying only on the MCP tool descriptions.

## References

- [Prisma CLI `mcp` command](https://docs.prisma.io/docs/cli/mcp)
- [Prisma MCP Server](https://www.prisma.io/docs/ai/tools/chatgpt)
