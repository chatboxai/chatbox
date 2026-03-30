# Pencil CLI

- Source: https://docs.pencil.dev/for-developers/pencil-cli
- Fetched: 2026-03-30T17:59:42.279173+00:00
- Last updated on docs site: March 26, 2026

> Extracted snapshot from docs.pencil.dev for local Pencil reference.

# Pencil CLI

The Pencil CLI is a standalone command-line tool for creating and editing .pen design files from the terminal. It runs the same editor engine as the desktop app and IDE extension, fully headless — no GUI required.

Use it to run the AI agent with a prompt, call MCP tools directly in an interactive shell, batch-process multiple designs, or export to PNG/JPEG/WEBP/PDF.

## Installation

```text
npm
 install
 -g
 @pencil.dev/cli
```

Verify the installation:

```text
pencil
 version
```

Requires Node.js 18 or later.

## Authentication

The CLI requires authentication before running agent operations. There are two methods.

### Interactive Login

```text
pencil
 login
```

This starts an interactive session where you choose your login method (email + password or email + OTP code). On success the session token is stored in ~/.pencil/session-cli.json .

### CLI Key (for CI/CD)

Set the PENCIL_CLI_KEY environment variable. CLI keys are scoped to an organization and can be created in the Developer Keys section of your organization settings on the Pencil web app.

```text
PENCIL_CLI_KEY
=
pencil_cli_...
 pencil
 --out
 design.pen
 --prompt
 "Create a form"
```

The CLI key always takes precedence over a stored session token.

### Checking Status

```text
pencil
 status
```

Displays the current authentication method, verifies the session with the backend, and shows account details.

## Quick Start

```text
# Log in first


pencil
 login


 


# Create a new design from scratch


pencil
 --out
 design.pen
 --prompt
 "Create a login page with email and password fields"


 


# Modify an existing design


pencil
 --in
 existing.pen
 --out
 modified.pen
 --prompt
 "Add a blue submit button"


 


# Export a design to PNG


pencil
 --in
 design.pen
 --export
 design.png


 


# Start an interactive shell


pencil
 interactive
 -o
 design.pen


 


# List available models


pencil
 --list-models
```

## Commands

### pencil login

Log in interactively via email + password or email + OTP.

### pencil status

Check authentication status and display account details.

### pencil version

Print the installed CLI version.

### pencil interactive

Start an interactive tool shell. See Interactive Mode below.

## Agent Mode

Run the AI agent with a prompt to create or modify designs.

```text
pencil [options]
```

| Option                 | Description                                                      |
| ---------------------- | ---------------------------------------------------------------- |
| --in, -i <path>        | Input .pen file (optional — starts with empty canvas if omitted) |
| --out, -o <path>       | Output .pen file path (required unless --export is used)         |
| --prompt, -p <text>    | Prompt for the AI agent                                          |
| --model, -m <id>       | Model to use (default: claude-opus-4-6 )                         |
| --custom, -c           | Use custom Claude model config (e.g. AWS Bedrock, Vertex AI)     |
| --list-models          | List available models and exit                                   |
| --tasks, -t <path>     | JSON tasks file for batch operations                             |
| --workspace, -w <path> | Workspace folder path for the agent                              |
| --export, -e <path>    | Export an image of the final result                              |
| --export-scale <n>     | Export scale factor (default: 1)                                 |
| --export-type <type>   | Export format: png , jpeg , webp , pdf (default: png )           |
| --verbose-mcp          | Log full MCP tool error details to the console                   |
| --help, -h             | Show help message                                                |

### Examples

Create a new design:

```text
pencil
 --out
 login.pen
 --prompt
 "Create a modern login page with:


- Email input field


- Password input field


- Sign In button


- Forgot password link


- Social login options (Google, GitHub)"
```

Modify an existing design:

```text
pencil
 --in
 dashboard.pen
 --out
 dashboard-v2.pen
 --prompt
 "Add a sidebar navigation with:


- Dashboard link (active)


- Users link


- Settings link


- Logout button at bottom"
```

Use a specific model:

```text
# Use Claude Haiku for simple, fast tasks


pencil
 --out
 simple.pen
 \


  --model
 claude-haiku-4-5
 \


  --prompt
 "Create a simple 404 error page"
```

Export to image:

```text
pencil
 --in
 design.pen
 --export
 hero.png
 --export-scale
 2
```

## Available Models

| Model ID          | Description                | Default |
| ----------------- | -------------------------- | ------- |
| claude-opus-4-6   | Most capable, higher cost  | ✓       |
| claude-sonnet-4-6 | Fast, balanced performance |         |
| claude-haiku-4-5  | Fastest, lowest cost       |         |

List available models at any time with:

```text
pencil
 --list-models
```

## Interactive Mode

The interactive shell lets you call MCP tools directly on .pen files — useful for scripting, debugging, and agentic workflows that need fine-grained control over design operations.

```text
pencil interactive [options]
```

| Option           | Description                                              |
| ---------------- | -------------------------------------------------------- |
| --app, -a <name> | Connect to a running Pencil app (e.g. desktop , vscode ) |
| --in, -i <path>  | Input .pen file (optional — empty canvas if omitted)     |
| --out, -o <path> | Output .pen file (required in headless mode)             |
| --help, -h       | Show detailed tool reference                             |

### App Mode

Connects to a running Pencil desktop app or extension via WebSocket. Changes are applied live.

```text
pencil
 interactive
 -a
 desktop
 -i
 my-design.pen
```

### Headless Mode

Spins up a local editor without a GUI. Use save() to write to the output file.

```text
# New empty canvas


pencil
 interactive
 -o
 output.pen


 


# Edit an existing file


pencil
 interactive
 -i
 input.pen
 -o
 output.pen
```

### Shell Commands

```text
tool_name({ key: value })   Call an MCP tool with arguments


tool_name()                 Call an MCP tool with no arguments


save()                      Save the document to disk


exit()                      Exit the shell
```

### Example Session

```text
pencil > get_editor_state({ include_schema: true })


pencil > get_guidelines()


pencil > get_guidelines({ category: "guide", name: "Landing Page" })


pencil > batch_design({ operations: 'hero=I(document,{type:"frame",name:"Hero",x:0,y:0,width:1440,height:900,fill:"#0A0A0A"})' })


pencil > get_screenshot({ nodeId: "hero" })


pencil > save()


pencil > exit()
```

Run pencil interactive --help for the full tool reference with parameter types and descriptions.

## Batch Processing

Use --tasks to process multiple designs from a JSON file. Tasks run sequentially — each one gets its own editor instance.

```text
pencil
 --tasks
 batch.json
```

Example batch.json :

```text
{


  "tasks"
: [


    {


      "out"
: 
"landing-page.pen"
,


      "prompt"
: 
"Create a SaaS landing page with hero, features, and pricing sections"


    },


    {


      "in"
: 
"existing-app.pen"
,


      "out"
: 
"existing-app-v2.pen"
,


      "prompt"
: 
"Add a dark mode toggle to the header"


    },


    {


      "out"
: 
"mobile-menu.pen"
,


      "model"
: 
"claude-haiku-4-5"
,


      "prompt"
: 
"Create a mobile hamburger menu component"


    }


  ]


}
```

Each task supports:

| Field  | Required | Description           |
| ------ | -------- | --------------------- |
| out    | Yes      | Output .pen file path |
| prompt | Yes      | AI prompt             |
| in     | No       | Input .pen file       |
| model  | No       | Model override        |

## Supported MCP Tools

The CLI supports the same MCP tools as the desktop app and IDE extension.

### Design Operations

| Tool                            | Description                                            |
| ------------------------------- | ------------------------------------------------------ |
| batch_design                    | Insert, update, delete, move, copy, replace nodes      |
| batch_get                       | Search and read nodes by pattern or ID                 |
| get_variables                   | Read design variables                                  |
| set_variables                   | Update design variables                                |
| get_editor_state                | Get document metadata and structure                    |
| snapshot_layout                 | Get document structure with computed bounds            |
| find_empty_space_on_canvas      | Find available space for new elements                  |
| search_all_unique_properties    | Recursively search unique properties on a node tree    |
| replace_all_matching_properties | Recursively replace matching properties on a node tree |

### Visual Operations

| Tool           | Description                       |
| -------------- | --------------------------------- |
| get_screenshot | Render a node to PNG image        |
| export_nodes   | Export nodes to PNG/JPEG/WEBP/PDF |

### Image Generation

The batch_design G() operation supports both AI-generated and stock images:

| Type                         | Description                           |
| ---------------------------- | ------------------------------------- |
| G(nodeId, "ai", prompt)      | AI-generated image from a text prompt |
| G(nodeId, "stock", keywords) | Stock photo from Unsplash             |

### Style & Guidelines

| Tool           | Description                                        |
| -------------- | -------------------------------------------------- |
| get_guidelines | Load guides and styles for working with .pen files |

## CI/CD Usage

Use a CLI key and Anthropic API key to run Pencil in automated pipelines.

```text
export
 PENCIL_CLI_KEY
=
pencil_cli_...


export
 ANTHROPIC_API_KEY
=
sk-ant-...


 


pencil
 --out
 onboarding.pen
 --prompt
 "Create a 3-step onboarding flow"
```

## Environment Variables

| Variable          | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| PENCIL_CLI_KEY    | CLI API key for CI/CD (takes precedence over stored session) |
| ANTHROPIC_API_KEY | Your Anthropic API key                                       |
| PENCIL_API_BASE   | Backend API base URL (default: https://api.pencil.dev )      |
| DEBUG             | Enable debug logging                                         |

## Token Storage

| File                       | Purpose                         |
| -------------------------- | ------------------------------- |
| ~/.pencil/session-cli.json | Session token from pencil login |

The CLI uses a separate session file from the desktop app so the backend can distinguish which client is in use.
