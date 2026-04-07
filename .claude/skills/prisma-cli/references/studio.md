# prisma studio

Opens a visual database browser for viewing and editing data.

## Command

```bash
prisma studio [options]
```

## What It Does

- Starts a web-based database GUI
- View all your models and records
- Create, update, and delete records
- Filter and sort data
- Navigate relations

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port` / `-p` | Port to start Studio on | `5555` |
| `--browser` / `-b` | Browser to open Studio in | System default |
| `--config` | Custom path to your Prisma config file | - |
| `--url` | Database connection string (overrides the one in your Prisma config) | - |

## Examples

### Open Studio

```bash
prisma studio
```

Opens at http://localhost:5555

### Custom port

```bash
prisma studio --port 3000
```

### Specific browser

```bash
prisma studio --browser firefox
```

### Don't open browser

```bash
BROWSER=none prisma studio
```

Useful for remote servers.

## Features

### View Records

- See all records in table format
- Pagination for large datasets
- Column sorting

### Filter Data

- Filter by any field
- Multiple conditions
- Relation filtering

### Edit Records

- Click to edit inline
- Add new records
- Delete records (with confirmation)

### Navigate Relations

- Click relations to view related records
- See counts of related items
- Follow relation links

## Recent Studio Capabilities

Recent Prisma Studio releases added richer editor workflows:

- multi-cell selection and editing
- full-table search and more intuitive filtering
- command palette shortcuts
- dark mode
- copy selections as Markdown
- back-relation navigation
- SQL workflows including raw SQL queries

Some recent builds also expose AI-assisted SQL authoring. Treat these as interactive Studio features rather than a replacement for checked-in migrations or application queries.

## Use Cases

- **Development**: Quick data inspection
- **Debugging**: Check data state
- **Testing**: Verify seed data
- **Demo**: Show data to stakeholders

## Limitations

- Development tool only
- Not for production use
- Limited to configured database
- Prisma Studio in Prisma 7 currently targets PostgreSQL, MySQL, and SQLite first
- For reproducible application logic, prefer Prisma Client and checked-in SQL scripts

## Common Workflow

1. Run migrations:
   ```bash
   prisma migrate dev
   ```

2. Seed data:
   ```bash
   prisma db seed
   ```

3. Open Studio to verify:
   ```bash
   prisma studio
   ```

4. Make manual edits if needed

## Security Note

Studio provides direct database access. Only run on:
- Local development machines
- Secure internal networks
- Never expose publicly
