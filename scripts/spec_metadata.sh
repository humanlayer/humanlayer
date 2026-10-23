#!/usr/bin/env bash
set -euo pipefail

# Collect metadata
DATETIME_TZ=$(date '+%Y-%m-%d %H:%M:%S %Z')
FILENAME_TS=$(date '+%Y-%m-%d_%H-%M-%S')

if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  REPO_ROOT=$(git rev-parse --show-toplevel)
  REPO_NAME=$(basename "$REPO_ROOT")
  GIT_BRANCH=$(git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD)
  GIT_COMMIT=$(git rev-parse HEAD)
else
  REPO_ROOT=""
  REPO_NAME=""
  GIT_BRANCH=""
  GIT_COMMIT=""
fi

# Optional: thoughts system status (may be long). Limit lines to avoid noise.
THOUGHTS_STATUS=""
if command -v humanlayer >/dev/null 2>&1; then
  # Capture first 40 lines; adjust as needed.
  THOUGHTS_STATUS=$(humanlayer thoughts status 2>/dev/null | head -n 40)
fi

# Print similar to the individual command outputs
echo "Current Date/Time (TZ): $DATETIME_TZ"
[ -n "$GIT_COMMIT" ] && echo "Current Git Commit Hash: $GIT_COMMIT"
[ -n "$GIT_BRANCH" ] && echo "Current Branch Name: $GIT_BRANCH"
[ -n "$REPO_NAME" ] && echo "Repository Name: $REPO_NAME"
echo "Timestamp For Filename: $FILENAME_TS"
[ -n "$THOUGHTS_STATUS" ] && {
  echo "$THOUGHTS_STATUS"
}
