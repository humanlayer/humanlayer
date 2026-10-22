#!/bin/bash
cd "$CLAUDE_PROJECT_DIR"

# If there's an ongoing merge, skip checks and notify
if [ -f .git/MERGE_HEAD ]; then
  echo "Typecheck and quality checks are failing due to an ongoing merge. Please continue working on the merge conflict with the user before worrying about typecheck and quality." >&2
  exit 2
fi

PREBUILD_OUTPUT=$(bun --bun run prebuild 2>&1)
if [ $? -ne 0 ]; then
  echo "prebuild failed:" >&2
  echo "$PREBUILD_OUTPUT" >&2
  exit 2
fi

OUTPUT=$(bun --bun run hook:quality 2>&1 && bun --bun turbo run typecheck 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "$OUTPUT" >&2
  exit 2
fi

exit 0
