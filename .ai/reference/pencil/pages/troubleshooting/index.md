# Troubleshooting

- Source: https://docs.pencil.dev/troubleshooting
- Fetched: 2026-04-02T23:18:43.741466+00:00
- Last updated on docs site: March 23, 2026

> Extracted snapshot from docs.pencil.dev for local Pencil reference.

# Troubleshooting

## Installation & Setup

### Extension installed but doesn’t connect

Symptoms:

- Pencil extension is installed but not functioning
- No Pencil icon in the editor
- Can’t open .pen files

Solutions:

1. Verify Claude Code is logged in: claude
2. Complete the activation process (check email for code)
3. Check that Pencil MCP server is connected (Settings → MCP)
4. Create a .pen file and try opening it
5. Restart your IDE
6. Reinstall the extension if issues persist

### Don’t see the Pencil icon

Try this:

1. Create a .pen file (e.g., test.pen )
2. Open the file
3. Check extension version in Extensions panel
4. Open Command Palette ( Cmd/Ctrl + Shift + P ) and search for “Pencil”
5. Verify the extension is enabled

## Authentication & Activation

### Not receiving activation email

Solutions:

1. Check spam/junk folder
2. Wait a few minutes (emails may be delayed)
3. Try a different email address
4. Reinstall the extension if activation gets stuck

### ”Invite for your email address was not found”

This can happen during activation:

1. Reinstall the Cursor/VS Code extension
2. Try activation again
3. Contact support if it continues

### Repeatedly prompted for activation

Known issue in some versions:

- Restart your IDE
- Complete activation once more
- Reinstall extension if it continues

### Claude Code connection issues

“Claude Code isn’t connected / not logged in”:

Working flow:

1. Open terminal in your project directory
2. Run claude and complete authentication
3. Return to Pencil
4. Try opening/editing a .pen file

“Invalid API key” or “Please run /login”:

Causes:

- Incomplete authentication
- Conflicting auth methods (CLI + env variables + custom providers)
- Expired credentials

Solutions:

1. Run claude CLI and authenticate
2. Check for conflicts:
  - Remove ANTHROPIC_API_KEY env variables if using CLI
  - Clear custom provider configs
3. Try a clean login session
4. Restart IDE after authenticating

Claude CLI works but Pencil says not logged in:

- Ensure no third-party/custom providers conflict
- Try a clean Claude Code session
- Restart your IDE
- Check for environment variable conflicts

## IDE-Specific Issues

### Cursor

Don’t see prompt editor/prompt box:

- Check activation/login status
- Restart Cursor
- Verify MCP connection in settings
- Reinstall extension if needed

“You need Cursor Pro”:

- Some features may require Cursor Pro subscription
- Check Cursor’s current plan restrictions
- Try basic features without Pro

### VS Code

Extension not activating:

- Ensure you have a .pen file open
- Check that extension is enabled
- Look for errors in Developer Tools Console
- Try reinstalling

## Welcome File & Onboarding

### Didn’t get the welcome file

Solution:

1. Right-click anywhere on the canvas
2. Choose Open Welcome File
3. It may open in a separate window

### Best way to add Pencil to a new project

Recommended flow:

1. Create a file like design.pen in your workspace
2. Open it in your IDE (Cursor/VS Code)
3. Activate Pencil
4. Keep the .pen file with your code so AI can see both

## Canvas & Interface

### Can’t navigate nested elements

Use keyboard shortcuts:

- Cmd/Ctrl + Click - Direct select (deepest element)
- Shift + Enter - Select parent
- Cmd/Ctrl + Enter - Select parent (alternate)

Or use layers panel:

- Available in the interface
- Shows full hierarchy
- Click to select elements

### Selection boxes confusing

Color meanings:

- Blue - Regular element
- Purple/magenta - Reusable component/symbol

### Converting to component doesn’t show purple box

After converting with Cmd/Ctrl + Option/Alt + K :

1. Deselect the element
2. Reselect it
3. Purple highlight should now appear

## Importing & Exporting

### Image import fails on macOS

Issue:

- Using File menu dropdown may fail

Solution:

- Use drag-and-drop instead
- Works reliably on all platforms

### Images don’t paste from Figma

Known limitation:

- Images are not supported when copy-pasting from Figma
- Use SVG or re-import images separately

### Export to Claude Code fails

“Process exited with code 1”:

Causes:

- Claude Code configuration issue
- Authentication problem
- Permission issue

Solutions:

1. Check Claude Code authentication: claude
2. Verify permissions
3. Try exporting in a separate Claude Code session
4. Check environment variables

### Exported output doesn’t match canvas

Known issue:

- Visual mismatch between canvas and export
- May indicate a bug

Workarounds:

1. Take a screenshot of the canvas for reference
2. Try re-exporting
3. Adjust the design and export again
4. Report the specific case for investigation

## MCP & AI Integration

### MCP server issues

Is the MCP server local or remote?

- The MCP server runs locally
- No cloud dependency for design operations

Verify MCP connection:

- Cursor: Settings → Tools & MCP
- VS Code: Check MCP configuration
- Codex: Run /mcp - Pencil should appear

### Codex config.toml modifications

Issue:

- Pencil may modify or duplicate Codex config

Workaround:

- Backup your config.toml before first use
- Issue is acknowledged and under investigation

### AI can’t access folders

“Pencil / Claude can’t access other folders”:

Solutions:

- Check folder permission restrictions
- Accept access prompts when they appear
- Update permissions in system settings
- Run IDE/Pencil with appropriate permissions

### Permission prompt never appeared

Workaround:

- Run the operation outside Pencil in a separate session
- Check system notification settings
- Verify IDE has necessary permissions

## Saving & Version Control

### No auto-save

Current status:

- Auto-save is not yet available
- Planned for future release

Workarounds:

- Save frequently with Cmd/Ctrl + S
- Use Git commits for version history
- Set a reminder to save regularly

### Limited undo/redo

Current limitations:

- Undo/redo may be more limited than standard design editors

Best practices:

- Save before major changes
- Commit to Git frequently
- Use Git history to revert if needed
- Make incremental changes

### No real-time collaboration

Current status:

- Real-time multiplayer not available
- Collaboration via Git only

Workflow:

- Use Git branches for parallel work
- Pull, edit, commit, push, create PR
- Review designs in pull requests

## Performance & UI

### Wayland/Hyprland UI issues (Linux)

Known issue:

- Some UI issues on Wayland/Hyprland

Workarounds:

- Use X11 environment if possible
- Report specific issues for investigation
- Desktop app may have better compatibility

## Platform-Specific

### Windows desktop app

Status:

- Not currently available
- Windows users should use VS Code or Cursor extension

Alternatives:

- Install VS Code extension
- Install Cursor extension
- Both work the same as on macOS/Linux

### Linux desktop app

Status:

- Available for Linux
- Some Wayland/Hyprland issues may occur

Recommendations:

- X11 environments more stable
- Try desktop app first
- Fall back to IDE extension if needed

## Getting More Help

### Still having issues?

1. Review relevant docs:
  - Installation
  - Authentication
  - AI Integration
2. Update everything:
  - Latest Pencil version
  - Latest Claude Code CLI
  - Latest IDE version
3. Try reinstalling:
  - Uninstall extension
  - Clear extension data
  - Reinstall fresh
4. Contact support with:
  - Your platform (macOS/Windows/Linux)
  - Pencil version
  - IDE and version
  - Exact error message
  - Steps to reproduce

## Reporting Bugs

When reporting issues, include:

Environment:

- OS and version
- IDE (VS Code/Cursor/Desktop) and version
- Pencil version
- Claude Code CLI version

Issue details:

- What you were trying to do
- What happened instead
- Exact error messages
- Steps to reproduce

Helpful extras:

- Screenshots
- Console logs (if applicable)
- Minimal .pen file that reproduces the issue

## Common Error Messages

| Error                        | Likely Cause      | Solution                  |
| ---------------------------- | ----------------- | ------------------------- |
| ”Claude Code not connected”  | Not logged in     | Run claude CLI            |
| ”Invalid API key”            | Auth conflict     | Clear env vars, re-auth   |
| ”Process exited with code 1” | Export/auth issue | Check Claude Code config  |
| ”Need Cursor Pro”            | Plan restriction  | Check Cursor subscription |
| ”Invite not found”           | Activation issue  | Reinstall extension       |
| ”Can’t access folder”        | Permissions       | Update folder permissions |

## Prevention Tips

Avoid common issues:

1. Save frequently (no auto-save yet)
2. Keep Claude Code authenticated
3. Keep .pen files in project workspace
4. Commit to Git regularly
5. Update Pencil and Claude Code regularly
6. Accept permission prompts
7. Use supported workflows (don’t try to manually edit .pen files)

Most issues can be resolved by ensuring Claude Code is properly authenticated and Pencil is up to date. When in doubt, try restarting your IDE and re-authenticating Claude Code.
