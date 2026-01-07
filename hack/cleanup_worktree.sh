#!/usr/bin/env bash
set -euo pipefail

# cleanup_worktree.sh - Clean up git worktrees with thoughts directory support
#
# Usage: ./hack/cleanup_worktree.sh [worktree_name]
#
# If no worktree name is provided, lists available worktrees to clean up

# Get the base repository name
REPO_BASE_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKTREE_BASE_DIR="$HOME/wt"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to list worktrees
list_worktrees() {
    echo -e "${YELLOW}Available worktrees:${NC}"
    git worktree list | grep -E "^${WORKTREE_BASE_DIR}/${REPO_BASE_NAME}/" || {
        echo "No worktrees found in $WORKTREE_BASE_DIR/$REPO_BASE_NAME/"
        return 1
    }
}

# Function to clean up a specific worktree
cleanup_worktree() {
    local worktree_name="$1"
    local worktree_path="$WORKTREE_BASE_DIR/${REPO_BASE_NAME}/${worktree_name}"
    local worktree_in_git=false
    local branch_exists=false
    local dir_exists=false

    # Check what exists
    if git worktree list | grep -qE "^${worktree_path}\b"; then
        worktree_in_git=true
    fi
    if git show-ref --verify --quiet "refs/heads/${worktree_name}"; then
        branch_exists=true
    fi
    if [ -d "$worktree_path" ]; then
        dir_exists=true
    fi

    # If nothing exists, error out
    if [ "$worktree_in_git" = false ] && [ "$branch_exists" = false ] && [ "$dir_exists" = false ]; then
        echo -e "${RED}Error: Nothing found to clean up for '$worktree_name'${NC}"
        echo "  - No worktree at $worktree_path"
        echo "  - No branch named '$worktree_name'"
        echo ""
        list_worktrees 2>/dev/null || true
        exit 1
    fi

    echo -e "${YELLOW}Cleaning up: $worktree_name${NC}"

    # Step 1: Handle thoughts directory if it exists
    if [ "$dir_exists" = true ] && [ -d "$worktree_path/thoughts" ]; then
        echo "Found thoughts directory, cleaning up..."

        # Try to use humanlayer uninit command first
        if command -v humanlayer >/dev/null 2>&1; then
            echo "Running humanlayer thoughts uninit..."
            (cd "$worktree_path" && humanlayer thoughts uninit --force) || {
                echo -e "${YELLOW}Warning: humanlayer uninit failed, falling back to manual cleanup${NC}"

                # Fallback: Reset permissions on searchable directory if it exists
                if [ -d "$worktree_path/thoughts/searchable" ]; then
                    echo "Resetting permissions on thoughts/searchable..."
                    chmod -R 755 "$worktree_path/thoughts/searchable" 2>/dev/null || true
                fi

                # Remove the entire thoughts directory
                echo "Removing thoughts directory..."
                rm -rf "$worktree_path/thoughts" || {
                    echo -e "${RED}Error: Could not remove thoughts directory${NC}"
                    echo "You may need to manually run: sudo rm -rf $worktree_path/thoughts"
                    exit 1
                }
            }
        else
            # No humanlayer command available, do manual cleanup
            echo "humanlayer command not found, using manual cleanup..."

            # Reset permissions on searchable directory if it exists
            if [ -d "$worktree_path/thoughts/searchable" ]; then
                echo "Resetting permissions on thoughts/searchable..."
                chmod -R 755 "$worktree_path/thoughts/searchable" 2>/dev/null || true
            fi

            # Remove the entire thoughts directory
            echo "Removing thoughts directory..."
            rm -rf "$worktree_path/thoughts" || {
                echo -e "${RED}Error: Could not remove thoughts directory${NC}"
                echo "You may need to manually run: sudo rm -rf $worktree_path/thoughts"
                exit 1
            }
        fi
    fi

    # Step 2: Remove the worktree (if registered in git)
    if [ "$worktree_in_git" = true ]; then
        echo "Removing git worktree..."
        if git worktree remove --force "$worktree_path" 2>/dev/null; then
            echo -e "${GREEN}✓ Worktree removed${NC}"
        else
            echo -e "${YELLOW}Warning: Could not remove worktree via git, trying manual cleanup${NC}"
        fi
    fi

    # Step 3: Remove directory if it still exists
    if [ -d "$worktree_path" ]; then
        echo "Removing directory..."
        rm -rf "$worktree_path" && echo -e "${GREEN}✓ Directory removed${NC}"
    fi

    # Step 4: Prune worktree references
    echo "Pruning worktree references..."
    git worktree prune

    # Step 5: Delete the branch
    if [ "$branch_exists" = true ]; then
        echo "Deleting branch '$worktree_name'..."
        if git branch -D "$worktree_name" 2>/dev/null; then
            echo -e "${GREEN}✓ Branch deleted${NC}"
        else
            echo -e "${YELLOW}Warning: Could not delete branch${NC}"
        fi
    fi

    echo ""
    echo -e "${GREEN}✓ Cleanup complete!${NC}"
}

# Main logic
if [ $# -eq 0 ]; then
    # No arguments provided, list worktrees
    list_worktrees || exit 1
    echo ""
    echo "Usage: $0 <worktree_name>"
    echo "Example: $0 swift_fix_1430"
    echo ""
    echo "Note: Provide just the worktree name, not the full path"
else
    # Worktree name provided
    cleanup_worktree "$1"
fi
