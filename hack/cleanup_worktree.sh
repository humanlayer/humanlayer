#!/usr/bin/env bash
set -euo pipefail

# cleanup_worktree.sh - Clean up git worktrees with thoughts directory support
#
# Usage: ./hack/cleanup_worktree.sh [worktree_name]
#
# If no worktree name is provided, lists available worktrees to clean up

# Get the base repository name
REPO_BASE_NAME=$(basename "$(git rev-parse --show-toplevel)")
WORKTREE_BASE_DIR="$HOME/.humanlayer/worktrees"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to list worktrees
list_worktrees() {
    echo -e "${YELLOW}Available worktrees:${NC}"
    git worktree list | grep -E "^\$WORKTREE_BASE_DIR" || {
        echo "No worktrees found in $WORKTREE_BASE_DIR"
        return 1
    }
}

# Function to clean up a specific worktree
cleanup_worktree() {
    local worktree_name="$1"
    local worktree_path="$WORKTREE_BASE_DIR/${REPO_BASE_NAME}_${worktree_name}"
    
    # Check if worktree exists
    if ! git worktree list | grep -q "$worktree_path"; then
        echo -e "${RED}Error: Worktree not found at $worktree_path${NC}"
        echo ""
        list_worktrees
        exit 1
    fi
    
    echo -e "${YELLOW}Cleaning up worktree: $worktree_path${NC}"
    
    # Step 1: Handle thoughts directory if it exists
    if [ -d "$worktree_path/thoughts" ]; then
        echo "Found thoughts directory, cleaning up..."
        
        # Reset permissions on searchable directory if it exists
        if [ -d "$worktree_path/thoughts/searchable" ]; then
            echo "Resetting permissions on thoughts/searchable..."
            chmod -R 755 "$worktree_path/thoughts/searchable" 2>/dev/null || {
                echo -e "${YELLOW}Warning: Could not reset all permissions, but continuing...${NC}"
            }
        fi
        
        # Remove the entire thoughts directory
        echo "Removing thoughts directory..."
        rm -rf "$worktree_path/thoughts" || {
            echo -e "${RED}Error: Could not remove thoughts directory${NC}"
            echo "You may need to manually run: sudo rm -rf $worktree_path/thoughts"
            exit 1
        }
    fi
    
    # Step 2: Remove the worktree
    echo "Removing git worktree..."
    if git worktree remove --force "$worktree_path"; then
        echo -e "${GREEN}✓ Worktree removed successfully${NC}"
    else
        echo -e "${RED}Error: Failed to remove worktree${NC}"
        echo "The worktree might be in an inconsistent state."
        echo ""
        echo "Try manually running:"
        echo "  rm -rf $worktree_path"
        echo "  git worktree prune"
        exit 1
    fi
    
    # Step 3: Delete the branch (optional, with confirmation)
    echo ""
    read -p "Delete the branch '$worktree_name'? (y/N) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if git branch -D "$worktree_name" 2>/dev/null; then
            echo -e "${GREEN}✓ Branch deleted${NC}"
        else
            echo -e "${YELLOW}Branch might not exist or already deleted${NC}"
        fi
    else
        echo "Branch kept: $worktree_name"
    fi
    
    # Step 4: Prune worktree references
    echo "Pruning worktree references..."
    git worktree prune
    
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