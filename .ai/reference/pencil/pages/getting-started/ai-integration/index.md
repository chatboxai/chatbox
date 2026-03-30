# AI Integration

- Source: https://docs.pencil.dev/getting-started/ai-integration
- Fetched: 2026-03-30T17:59:42.279173+00:00
- Last updated on docs site: March 23, 2026

> Extracted snapshot from docs.pencil.dev for local Pencil reference.

# AI Integration

Pencil’s deep integration with AI assistants via the Model Context Protocol (MCP) enables powerful design automation and workflows.

## Supported AI Assistants

Pencil works with multiple AI tools through MCP:

- Claude Code (CLI and IDE)
- Claude Desktop
- Cursor (AI-powered IDE)
- Windsurf IDE (Codeium)
- Codex CLI (OpenAI)
- Antigravity IDE
- OpenCode CLI

## MCP (Model Context Protocol)

### What is MCP?

MCP is a protocol that gives AI assistants tools to interact with your design files. Think of it as an API that lets AI read and modify .pen files programmatically.

### How It Works

1. Pencil MCP Server runs locally - No cloud dependency for design operations
2. AI assistants connect via MCP when Pencil is running
3. AI can use tools to read, modify, and generate designs
4. You stay in control - AI suggests, you approve

### Security & Privacy

- Local-only: MCP server runs on your machine
- No remote access: Design files stay local
- Repository is private: Source code not yet public
- Tool inspection: View available tools in IDE settings

## Using Claude Code

### Setup

Prerequisites:

1. Install Claude Code CLI
2. Authenticate: claude
3. Have Pencil running
4. Open a .pen file

### Pencil in Antigravity (or VSCode) with Claude Code panel

### Basic Workflow

1. Open AI prompt panel: Press Cmd/Ctrl + K
2. Ask for design help: "Create a login form with email and password" "Add a navigation bar to this page" "Design a card component for my design system"
3. AI uses MCP tools to modify your .pen file
4. See changes reflected in the canvas immediately

### Example Prompts

Creating designs:

- “Design a dashboard with sidebar and main content area”
- “Create a pricing table with 3 tiers”
- “Add a hero section with heading and CTA button”

Modifying designs:

- “Change all primary buttons to blue”
- “Make the sidebar narrower”
- “Add spacing between these elements”

Design systems:

- “Create a button component with variants”
- “Generate a color palette based on #3b82f6”
- “Build a typography scale”

Code integration:

- “Generate React code for this component”
- “Import the Header from my codebase”
- “Create Tailwind config from these variables”

## Using Cursor

### Setup

1. Install Pencil extension in Cursor
2. Complete activation
3. Authenticate Claude Code
4. Verify MCP connection: Settings → Tools & MCP

### Using Pencil Extension in Cursor

### Cursor-Specific Features

Inline editing:

- Select elements in Pencil
- Use Cursor’s AI chat to modify
- Changes apply to .pen file

Codebase awareness:

- Cursor can see both your code and designs
- Ask to sync components between them
- Maintain consistency automatically

### Common Issues

“Need Cursor Pro”:

- Some features may require Cursor Pro subscription
- Check Cursor’s pricing for current limitations

Prompt panel missing:

- Check activation/login status
- Restart Cursor
- Verify MCP connection in settings

## Using Codex CLI

### Setup

1. Run Pencil first - Start the desktop app or IDE extension
2. Open Codex in your terminal
3. Verify MCP connection: /mcp
4. Pencil should appear in the MCP server list

### Working with Codex

Design prompts in terminal:

```text
# In Codex CLI


>
 Create a button component in design.pen


>
 Add a hero section to the landing page


>
 Generate a color scheme based on blue
```

Benefits:

- Command-line workflow
- Scriptable design generation
- Integrate with build tools

### Known Issues

Codex config.toml modifications:

- Pencil may modify or duplicate the config
- Issue is acknowledged and under investigation
- Backup your config before first use

## MCP Tools Available

When AI assistants connect to Pencil via MCP, they get access to these tools:

### Design Tools

batch_design:

- Create, modify, and manipulate design elements
- Insert, copy, update, replace, move, delete operations
- Generate and place images

batch_get:

- Read design components and hierarchy
- Search for elements by patterns
- Inspect component structure

### Analysis Tools

get_screenshot:

- Render design previews
- Verify visual output
- Compare before/after

snapshot_layout:

- Analyze layout structure
- Detect positioning issues
- Find overlapping elements

get_editor_state:

- Current editor context
- Selection information
- Active file details

### Variables & Theming

get_variables / set_variables:

- Read design tokens
- Update theme values
- Sync with CSS

### And More

View all available tools:

- Cursor: Settings → Tools & MCP
- VS Code: Check MCP configuration
- Codex: Run /mcp and inspect Pencil tools

## Advanced Workflows

### Automated Design Generation

Style guides: Ask AI to follow specific design systems:

```text
"Create a dashboard using Material Design principles"


"Design a landing page with modern, minimal aesthetics"


"Build components following our design system in design-system.pen"
```

Batch operations:

```text
"Create 5 variations of this button component"


"Generate a complete form with all input types"


"Design an entire landing page with hero, features, pricing, and footer"
```

### Design System Management

Consistency enforcement:

```text
"Ensure all buttons use the primary color variable"


"Update all headings to use the typography scale"


"Apply 8px spacing grid to all elements"
```

Component library:

```text
"Create a complete button component with all variants"


"Generate form input components (text, select, checkbox, radio)"


"Build a card component with image, title, description, and actions"
```

### Code-Design Workflows

Import existing app:

```text
"Recreate all components from src/components in Pencil"


"Import the design system from our Tailwind config"


"Analyze the codebase and create matching designs"
```

Sync changes:

```text
"Update all React components to match the Pencil designs"


"Apply the new color scheme to both design and code"


"Sync typography variables between CSS and Pencil"
```

## Best Practices

### Effective Prompting

Be specific:

- ❌ “Make it better”
- ✅ “Increase the button padding to 16px and change color to blue”

Provide context:

- ❌ “Add a form”
- ✅ “Add a login form with email, password, remember me checkbox, and submit button”

Reference design systems:

- “Use our existing button component”
- “Follow the spacing scale from our variables”
- “Match the style of the header component”

### Iterative Design

1. Start broad: “Create a dashboard layout”
2. Refine: “Add a sidebar with navigation items”
3. Detail: “Style the nav items with hover states”
4. Polish: “Adjust spacing to match 8px grid”

### Verification

After AI makes changes:

1. Review visually in the canvas
2. Check structure in layers panel
3. Test interactions if applicable
4. Ask for screenshots to verify complex layouts

## Troubleshooting AI Integration

### Connection Issues

“Claude Code not connected”:

1. Ensure Claude Code is logged in: claude
2. Restart Pencil
3. Open terminal in project directory and run claude

MCP server not appearing:

1. Verify Pencil is running
2. Check IDE MCP settings
3. Restart both Pencil and the AI assistant

### Permission Issues

“Can’t access folders”:

- Accept permission prompts
- Check system folder permissions
- Run IDE/Pencil with proper permissions

“Permission prompt never appeared”:

- Try operation in separate Claude Code session
- Check notification settings
- Verify IDE permissions

### AI Output Issues

“Invalid API key”:

- Re-authenticate Claude Code: claude
- Check for conflicting auth configs
- Clear environment variables

AI makes unexpected changes:

- Be more specific in prompts
- Ask AI to explain before applying
- Use version control to revert if needed

## Example Session

```text
# 1. Start Pencil and Claude Code


claude




# 2. Open design.pen in IDE




# 3. Press Cmd + K and start designing


User: "Create a modern landing page hero section"


AI: [Creates hero with heading, subheading, CTA buttons]




User: "Add a features section with 3 columns"


AI: [Adds features section below hero]




User: "Use our primary color variable for the CTA buttons"


AI: [Updates buttons to use color variable]




User: "Generate React code for this entire page"


AI: [Exports to React component with Tailwind CSS]




# 4. Review and refine


# 5. Commit to Git


git add design.pen src/pages/landing.tsx


git commit -m "Add landing page design and implementation"
```
