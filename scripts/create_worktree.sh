#!/bin/bash

# create_worktree.sh - Create a new worktree for development work
# If no name provided, generates a unique human-readable one
# If no base branch provided, uses current branch
# Use --existing-branch to specify an existing branch (local or remote like origin/branch-name) with a different dir name

set -e  # Exit on any error


# Function to generate a unique worktree name
generate_unique_name() {
    local adjectives=("swift" "bright" "clever" "smooth" "quick" "clean" "sharp" "neat" "cool" "fast")
    local nouns=("fix" "task" "work" "dev" "patch" "branch" "code" "build" "test" "run")

    local adj=${adjectives[$RANDOM % ${#adjectives[@]}]}
    local noun=${nouns[$RANDOM % ${#nouns[@]}]}
    local timestamp=$(date +%H%M)

    echo "${adj}_${noun}_${timestamp}"
}

# Parse flags
EXISTING_BRANCH=""
NO_PULL=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --existing-branch)
            EXISTING_BRANCH="$2"
            shift 2
            ;;
        --no-pull)
            NO_PULL=true
            shift
            ;;
        *)
            break
            ;;
    esac
done

# Get worktree name from parameter or generate one
WORKTREE_NAME=${1:-$(generate_unique_name)}

# Strip any prefix before slash for directory name (e.g., "dexter/branch-name" -> "branch-name")
# Keep the full name for the git branch, but use stripped version for directory
WORKTREE_DIR_NAME="${WORKTREE_NAME##*/}"

# Get base branch from second parameter or use current branch
BASE_BRANCH=${2:-$(git branch --show-current)}

# Get base directory name (should be 'humanlayer')
REPO_BASE_NAME=humanlayer

if [ ! -z "$HUMANLAYER_WORKTREE_OVERRIDE_BASE" ]; then
    WORKTREES_BASE="${HUMANLAYER_WORKTREE_OVERRIDE_BASE}/${REPO_BASE_NAME}"
else
    WORKTREES_BASE="$HOME/wt/${REPO_BASE_NAME}"
fi

WORKTREE_PATH="${WORKTREES_BASE}/${WORKTREE_DIR_NAME}"

echo "🌳 Creating worktree: ${WORKTREE_NAME}"
echo "📁 Location: ${WORKTREE_PATH}"

# Check if worktrees base directory exists
if [ ! -d "$WORKTREES_BASE" ]; then
    echo "❌ Error: Directory $WORKTREES_BASE does not exist."
    echo "   Please create it first: mkdir -p $WORKTREES_BASE"
    exit 1
fi

# Check if worktree already exists
if [ -d "$WORKTREE_PATH" ]; then
    echo "❌ Error: Worktree directory already exists: $WORKTREE_PATH"
    exit 1
fi

# Display base branch info
echo "🔀 Creating from branch: ${BASE_BRANCH}"

# Create worktree
if [ -n "$EXISTING_BRANCH" ]; then
    # Check if it's a remote branch (starts with origin/)
    if [[ "$EXISTING_BRANCH" == origin/* ]]; then
        # Extract local branch name by stripping origin/
        LOCAL_BRANCH_NAME="${EXISTING_BRANCH#origin/}"
        echo "🔄 Fetching remote branch from origin: ${EXISTING_BRANCH}"
        git fetch origin "${LOCAL_BRANCH_NAME}"

        # Check if local branch already exists
        if git show-ref --verify --quiet "refs/heads/${LOCAL_BRANCH_NAME}"; then
            echo "📋 Using existing local branch: ${LOCAL_BRANCH_NAME}"
            git worktree add "$WORKTREE_PATH" "$LOCAL_BRANCH_NAME"
        else
            echo "🆕 Creating local tracking branch: ${LOCAL_BRANCH_NAME}"
            git worktree add -b "$LOCAL_BRANCH_NAME" "$WORKTREE_PATH" "$EXISTING_BRANCH"
        fi
        ACTUAL_BRANCH="$LOCAL_BRANCH_NAME"
    else
        # Local branch specified
        echo "📋 Using specified branch: ${EXISTING_BRANCH}"
        git worktree add "$WORKTREE_PATH" "$EXISTING_BRANCH"
        ACTUAL_BRANCH="$EXISTING_BRANCH"
    fi
elif git show-ref --verify --quiet "refs/heads/${WORKTREE_NAME}"; then
    echo "📋 Using existing local branch: ${WORKTREE_NAME}"
    git worktree add "$WORKTREE_PATH" "$WORKTREE_NAME"
    ACTUAL_BRANCH="$WORKTREE_NAME"
else
    # Check if branch exists on origin remote
    echo "🔍 Checking if branch exists on origin..."
    git fetch origin 2>/dev/null || true
    if git show-ref --verify --quiet "refs/remotes/origin/${WORKTREE_NAME}"; then
        echo "🔄 Found branch on origin, creating local tracking branch: ${WORKTREE_NAME}"
        git worktree add -b "$WORKTREE_NAME" "$WORKTREE_PATH" "origin/${WORKTREE_NAME}"
        ACTUAL_BRANCH="$WORKTREE_NAME"
    else
        echo "🆕 Creating new branch: ${WORKTREE_NAME}"
        git worktree add -b "$WORKTREE_NAME" "$WORKTREE_PATH" "$BASE_BRANCH"
        ACTUAL_BRANCH="$WORKTREE_NAME"
    fi
fi

# Copy Claude settings if present. Prefer a local override, then fall back to the shared repo config.
if [ -d ".claude" ]; then
    if [ -f ".claude/settings.local.json" ]; then
        echo "📋 Copying .claude/settings.local.json to worktree..."
        cp -r .claude/settings.local.json "$WORKTREE_PATH/.claude/settings.local.json"
    elif [ -f ".claude/settings.json" ]; then
        echo "📋 Copying .claude/settings.json to worktree..."
        cp -r .claude/settings.json "$WORKTREE_PATH/.claude/settings.json"
    fi
fi

# Copy all .env* files if any exist
ENV_FILES_COPIED=0
for env_file in .env*; do
    if [ -f "$env_file" ]; then
        echo "📋 Copying $env_file to worktree..."
        cp "$env_file" "$WORKTREE_PATH/"
        ENV_FILES_COPIED=$((ENV_FILES_COPIED + 1))
    fi
done
if [ $ENV_FILES_COPIED -eq 0 ]; then
    echo "⚠️  No .env* files found to copy"
elif [ $ENV_FILES_COPIED -eq 1 ]; then
    echo "✅ Copied 1 env file"
else
    echo "✅ Copied $ENV_FILES_COPIED env files"
fi

# Change to worktree directory
cd "$WORKTREE_PATH"

if [ "$NO_PULL" = true ]; then
    echo "⏭️  Skipping pull from origin/main"
else
    echo "🔄 Pulling latest from origin/main..."
    git pull origin main --no-ff || echo "⚠️  Could not pull from origin/main (remote may not exist)"
fi

echo "🔧 Setting up worktree dependencies..."
if ! make setup; then
    echo "❌ Setup failed"
    exit 1
fi
#

# echo "🧪 Verifying worktree with checks and tests..."
# temp_output=$(mktemp)
# if make check test > "$temp_output" 2>&1; then
#     rm "$temp_output"
#     echo "✅ All checks and tests pass!"
# else
#     cat "$temp_output"
#     rm "$temp_output"
#     echo "❌ Checks and tests failed. Cleaning up worktree..."
#     cd - > /dev/null
#     git worktree remove --force "$WORKTREE_PATH"
#     git branch -D "$WORKTREE_NAME" 2>/dev/null || true
#     echo "❌ Not allowed to create worktree from a branch that isn't passing checks and tests."
#     exit 1
# fi

# Return to original directory
cd - > /dev/null

echo "✅ Worktree created successfully!"
echo "📁 Path: ${WORKTREE_PATH}"
echo "🔀 Branch: ${ACTUAL_BRANCH}"
echo ""
echo "To work in this worktree:"
echo "  cd ${WORKTREE_PATH}"
echo ""
echo "To remove this worktree later:"
echo "  git worktree remove ${WORKTREE_PATH}"
