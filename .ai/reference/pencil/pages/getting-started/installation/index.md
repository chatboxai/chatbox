# Installation

- Source: https://docs.pencil.dev/getting-started/installation
- Fetched: 2026-04-02T23:18:43.741466+00:00
- Last updated on docs site: March 23, 2026

> Extracted snapshot from docs.pencil.dev for local Pencil reference.

# Installation

Pencil is available as an IDE extension and a standalone desktop application. Choose the option that best fits your workflow.

## VS Code Extension

### Installation

1. Open VS Code
2. Go to Extensions (Cmd/Ctrl + Shift + X)
3. Search for “Pencil”
4. Click Install

### Verification

1. Create a new file with a .pen extension (e.g., test.pen )
2. Open the file
3. Look for the Pencil icon in the top-right corner of the editor

If you don’t see the icon:

- Open Command Palette (Cmd/Ctrl + Shift + P)
- Search for “Pencil” to see available commands
- Check that the extension is enabled in your Extensions panel

## Cursor Extension

### Installation

1. Open Cursor
2. Go to Extensions
3. Search for “Pencil”
4. Click Install

### Verification

Same as VS Code - create a .pen file and verify the Pencil icon appears.

### Common Issues

Extension doesn’t connect:

- Ensure Claude Code is logged in ( claude CLI)
- Complete the activation process
- Check that Pencil MCP server is connected

Don’t see the prompt editor/prompt box:

- Check activation/login status
- Restart Cursor
- Reinstall the extension if issues persist

“You need Cursor Pro” message:

- This may occur depending on Cursor’s plan/tooling restrictions
- Check your Cursor subscription status

## Desktop Application

### macOS

Download:

- Get the latest .dmg from the Pencil website or releases page
- Drag Pencil to your Applications folder
- Launch Pencil

First Launch:

- macOS may ask you to verify the app (right-click → Open if you see a security warning)
- Complete the activation process
- Login to Claude Code if you plan to use AI features

### Linux

Supported:

- Pencil runs on Linux
- Download the appropriate package for your distribution

Known Issues:

- Some Wayland/Hyprland UI issues may occur
- X11 environments are more stable

Installation:

```text
# Example for .deb package


sudo
 dpkg
 -i
 pencil-
*
.deb


 


# Example for .AppImage


chmod
 +x
 pencil-
*
.AppImage


./pencil-*.AppImage
```

### Windows

Desktop App:

- Pencil runs on Windows
- Windows users can also use the VS Code or Cursor extension

Extension (Windows):

- Follow the VS Code or Cursor installation instructions above
- Works the same as on macOS/Linux

## Claude Code CLI

Pencil’s AI features require Claude Code to be installed and authenticated.

### Installation

```text
# Install Claude Code CLI


npm
 install
 -g
 @anthropic-ai/claude-code-cli


 


# Or using the official installer


curl
 https://claude.ai/cli/install.sh
 |
 sh
```

### Authentication

```text
# Login to Claude Code


claude


 


# Follow the browser authentication flow
```

### Verification

```text
# Check that you're logged in


claude
 --version
```

## MCP Server

The Pencil MCP (Model Context Protocol) server runs automatically when you use Pencil. It provides AI assistants with tools to read and manipulate .pen files.

### Automatic Setup

- The MCP server starts when you open Pencil
- It runs locally on your machine
- No additional configuration needed for basic use

### Verification

In Cursor:

- Open Settings → Tools & MCP
- Verify Pencil appears in the MCP server list

In Codex CLI:

1. Run Pencil first
2. Open Codex
3. Run /mcp
4. Pencil should appear in the MCP list

## Post-Installation

After installing Pencil:

1. Complete activation - You’ll need to activate Pencil with your email
2. Login to Claude Code - Required for AI features
3. Open the welcome file - Right-click canvas → Open Welcome File
4. Create your first design - See how to create a .pen file

## Updating Pencil

### VS Code/Cursor Extension

Extensions update automatically by default. To manually update:

1. Go to Extensions
2. Find Pencil
3. Click Update if available

### Desktop App

- The app will notify you when updates are available
- Download and install the latest version from the website

## Troubleshooting Installation

Extension installed but doesn’t connect:

- Verify Claude Code is logged in
- Complete the activation process
- Restart your IDE

Activation email not received:

- Check spam/junk folder
- Try a different email address
- Reinstall the extension

“Invalid API key” or “Please run /login”:

- Run claude CLI and complete authentication
- Ensure no conflicting auth configurations (environment keys, custom providers)

See the full Troubleshooting guide for more issues and solutions.
