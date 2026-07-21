#!/bin/bash
# Ralph Wiggum - Long-running AI agent loop
# Usage: ./ralph.sh [max_iterations] [cli_tool] [model] [share]
# cli_tool: amp (default) or opencode
# model: opencode model ID or amp mode (smart/rush)
# share: true/false (default: false) - share session for opencode

set -e

MAX_ITERATIONS=${1:-10}
CLI_TOOL=${2:-amp}
MODEL=${3:-}
SHARE=${4:-false}
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT_FILE="$SCRIPT_DIR/prompt-$CLI_TOOL.md"

# Set opencode permissions via environment variable (equivalent to --dangerously-allow-all)
if [ "$CLI_TOOL" = "opencode" ]; then
	export OPENCODE_PERMISSION='{"*": "allow"}'
	export OPENCODE_DISABLE_AUTOCOMPACT=true
fi

PRD_FILE="$SCRIPT_DIR/prd.json"
PROGRESS_FILE="$SCRIPT_DIR/progress.txt"
ARCHIVE_DIR="$SCRIPT_DIR/archive"
LAST_BRANCH_FILE="$SCRIPT_DIR/.last-branch"

# Archive previous run if branch changed
if [ -f "$PRD_FILE" ] && [ -f "$LAST_BRANCH_FILE" ]; then
	CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
	LAST_BRANCH=$(cat "$LAST_BRANCH_FILE" 2>/dev/null || echo "")

	if [ -n "$CURRENT_BRANCH" ] && [ -n "$LAST_BRANCH" ] && [ "$CURRENT_BRANCH" != "$LAST_BRANCH" ]; then
		# Archive the previous run
		DATE=$(date +%Y-%m-%d)
		# Strip "ralph/" prefix from branch name for folder
		FOLDER_NAME=$(echo "$LAST_BRANCH" | sed 's|^ralph/||')
		ARCHIVE_FOLDER="$ARCHIVE_DIR/$DATE-$FOLDER_NAME"

		echo "Archiving previous run: $LAST_BRANCH"
		mkdir -p "$ARCHIVE_FOLDER"
		[ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$ARCHIVE_FOLDER/"
		[ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$ARCHIVE_FOLDER/"
		echo "   Archived to: $ARCHIVE_FOLDER"

		# Reset progress file for new run
		echo "# Ralph Progress Log" >"$PROGRESS_FILE"
		echo "Started: $(date)" >>"$PROGRESS_FILE"
		echo "---" >>"$PROGRESS_FILE"
	fi
fi

# Track current branch
if [ -f "$PRD_FILE" ]; then
	CURRENT_BRANCH=$(jq -r '.branchName // empty' "$PRD_FILE" 2>/dev/null || echo "")
	if [ -n "$CURRENT_BRANCH" ]; then
		echo "$CURRENT_BRANCH" >"$LAST_BRANCH_FILE"
	fi
fi

# Initialize progress file if it doesn't exist
if [ ! -f "$PROGRESS_FILE" ]; then
	echo "# Ralph Progress Log" >"$PROGRESS_FILE"
	echo "Started: $(date)" >>"$PROGRESS_FILE"
	echo "---" >>"$PROGRESS_FILE"
fi

echo "Starting Ralph - Max iterations: $MAX_ITERATIONS"
if [ -n "$MODEL" ]; then
	echo "Using CLI: $CLI_TOOL (model: $MODEL)"
else
	echo "Using CLI: $CLI_TOOL (default model)"
fi
if [ "$CLI_TOOL" = "opencode" ]; then
	echo "Share session: $SHARE"
fi

for i in $(seq 1 $MAX_ITERATIONS); do
	echo ""
	echo "═══════════════════════════════════════════════════════"
	echo "  Ralph Iteration $i of $MAX_ITERATIONS"
	echo "═══════════════════════════════════════════════════════"

	# Run amp or opencode with the ralph prompt
	if [ "$CLI_TOOL" = "opencode" ]; then
		OPENCODE_MODEL=${MODEL:-github-copilot/claude-opus-4.5}
		if [ "$SHARE" = "true" ]; then
			OUTPUT=$(cat "$PROMPT_FILE" | opencode run -m "$OPENCODE_MODEL"  --variant high --agent Sisyphus --share - 2>&1 | tee /dev/stderr) || true
		else
			OUTPUT=$(cat "$PROMPT_FILE" | opencode run -m "$OPENCODE_MODEL"  --variant high --agent Sisyphus - 2>&1 | tee /dev/stderr) || true
		fi
	else
		if [ -n "$MODEL" ]; then
			OUTPUT=$(cat "$PROMPT_FILE" | amp --dangerously-allow-all --mode "$MODEL" 2>&1 | tee /dev/stderr) || true
		else
			OUTPUT=$(cat "$PROMPT_FILE" | amp --dangerously-allow-all 2>&1 | tee /dev/stderr) || true
		fi
	fi

	# Check for completion signal
	if echo "$OUTPUT" | grep -q "<promise>COMPLETE</promise>"; then
		echo ""
		echo "Ralph completed all tasks!"
		echo "Completed at iteration $i of $MAX_ITERATIONS"
		exit 0
	fi

	echo "Iteration $i complete. Continuing..."
	sleep 2
done

echo ""
echo "Ralph reached max iterations ($MAX_ITERATIONS) without completing all tasks."
echo "Check $PROGRESS_FILE for status."
exit 1
