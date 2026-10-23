#!/usr/bin/env bash
set -euo pipefail

# pr_diff_urls.sh - Generate GitHub PR diff URLs with file anchors
#
# Usage: scripts/pr_diff_urls.sh <pr_number>
# Output: Markdown links for each changed file in the PR

PR_NUMBER="${1:-}"

if [[ -z "$PR_NUMBER" ]]; then
    echo "Error: PR number required" >&2
    echo "Usage: scripts/pr_diff_urls.sh <pr_number>" >&2
    exit 1
fi

# Validate no uncommitted changes
if ! git diff --quiet 2>/dev/null; then
    echo "Error: Uncommitted changes detected. Please commit or stash changes first." >&2
    exit 1
fi

if ! git diff --cached --quiet 2>/dev/null; then
    echo "Error: Staged changes detected. Please commit or stash changes first." >&2
    exit 1
fi

# Get repo info
REPO_INFO=$(gh repo view --json owner,name 2>/dev/null) || {
    echo "Error: Could not get repo info. Is gh CLI authenticated?" >&2
    exit 1
}

OWNER=$(echo "$REPO_INFO" | jq -r '.owner.login')
REPO=$(echo "$REPO_INFO" | jq -r '.name')

# Get PR files
PR_FILES=$(gh pr view "$PR_NUMBER" --json files 2>/dev/null) || {
    echo "Error: Could not get PR files. Does PR #$PR_NUMBER exist?" >&2
    exit 1
}

# Get PR URL
PR_URL="https://github.com/${OWNER}/${REPO}/pull/${PR_NUMBER}"

# Output header
echo "# PR #${PR_NUMBER} File Diff URLs"
echo ""

# Process each file
echo "$PR_FILES" | jq -r '.files[].path' | while read -r file_path; do
    # Compute SHA-256 hash of file path (without trailing newline)
    sha256_hash=$(printf '%s' "$file_path" | shasum -a 256 | cut -d ' ' -f1)

    # Output markdown link
    echo "- [\`${file_path}\`](${PR_URL}/files#diff-${sha256_hash})"
done
