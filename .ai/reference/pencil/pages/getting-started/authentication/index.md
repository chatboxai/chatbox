# Authentication

- Source: https://docs.pencil.dev/getting-started/authentication
- Fetched: 2026-03-30T17:59:42.279173+00:00
- Last updated on docs site: March 23, 2026

> Extracted snapshot from docs.pencil.dev for local Pencil reference.

# Authentication

Pencil requires both activation (to use Pencil itself) and Claude Code authentication (for AI features).

## Pencil Activation

### First-Time Activation

When you first launch Pencil or install the extension, you’ll be prompted to activate:

1. Enter your email when prompted
2. Check your email for the activation code
3. Enter the code in Pencil to complete activation

### Activation Issues

Activation email not received:

- Check your spam/junk folder
- Try using a different email address
- Wait a few minutes - emails may be delayed

“Invite for your email address was not found. Please join the waitlist.”

- This can occur during activation
- Try reinstalling the Cursor/VS Code extension
- Contact support if the issue persists

Repeatedly prompted for activation:

- This is a known issue in some versions
- Try restarting your IDE
- Reinstall the extension if it continues

Activation stuck during migration:

- Reinstall the extension
- Clear extension data and try again

## Claude Code Authentication

Pencil’s AI features require Claude Code to be installed and authenticated.

### Login via CLI

The recommended method is using the Claude Code CLI:

```text
# Start Claude Code


claude


 


# Follow the browser authentication flow
```

This will:

1. Open your browser
2. Ask you to login with your Anthropic account
3. Save your authentication credentials locally

### Verification

To verify you’re logged in:

```text
# Check Claude Code status


claude
 --version
```

Or start Pencil and look for:

- No “Claude Code not connected” warnings
- AI prompt panel works (Cmd/Ctrl + K)

## Common Authentication Issues

### ”Claude Code isn’t connected / not logged in”

Solution:

1. Open a terminal in your project directory
2. Run claude to authenticate
3. Return to Pencil and try again

### ”Invalid API key” or “Please run /login”

Causes:

- Claude Code authentication is incomplete
- Multiple authentication methods conflict (console login + environment keys + custom provider config)
- Credentials expired or invalid

Solution:

1. Run claude CLI and complete authentication
2. Check for conflicting auth configurations:
  - Remove ANTHROPIC_API_KEY environment variables if using CLI auth
  - Clear custom provider configs if not needed
3. Try a clean Claude Code login session

### ”Claude CLI works, but Pencil still says I’m not logged in”

Causes:

- Using third-party/custom providers with conflicting auth setup
- Extension not recognizing CLI auth

Solution:

- Ensure a clean Claude Code login session (no custom providers)
- Restart your IDE after authenticating
- Check that no conflicting environment variables are set

## Authentication Methods

### Recommended: Claude CLI

The simplest and most reliable method:

- Run claude in your terminal
- Login via browser
- All Pencil features work automatically

### Alternative: API Keys

If you’re using custom authentication:

- Set ANTHROPIC_API_KEY environment variable
- Note: May conflict with CLI authentication
- Not recommended for typical usage

## Working Flow for Authentication

A commonly successful workflow:

1. Install Pencil (extension or desktop app)
2. Complete Pencil activation (email code)
3. Install Claude Code CLI
4. Authenticate Claude Code ( claude command)
5. Create a .pen file in your project
6. Start working - both Pencil and AI features should work

## Permissions & Access

### Folder Access

Issue: “Pencil / Claude can’t access other folders”

Cause:

- Folder permission restrictions
- OS security settings

Solution:

- Accept access prompts when they appear
- Update folder permissions in system settings
- Run your IDE/Pencil with appropriate permissions

### Missing Permission Prompts

Issue: “Claude requested permission to write somewhere, but I never saw a prompt”

Workaround:

- Run the operation outside Pencil in a separate Claude Code session
- Check system notification settings
- Verify IDE permissions

## Security & Privacy

### MCP Server

- The Pencil MCP server runs locally on your machine
- No design data is sent to remote servers (except when using AI features, which send prompts to Claude)
- The repository is currently private (no public documentation yet)

### Tool Definitions

You can inspect available MCP tools:

- In Cursor: Settings → Tools & MCP
- In VS Code: Check MCP configuration
- Tool definitions show what the AI can do with your designs

## Still Having Issues?

If you’re still experiencing authentication problems:

1. Check the Troubleshooting guide
2. Ensure you’re using the latest version of Pencil and Claude Code
3. Try reinstalling both Pencil and Claude Code CLI
