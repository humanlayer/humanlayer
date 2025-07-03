#!/bin/bash

# create_worktrees.sh - Create multiple worktrees for TUI fix tasks
# This script just calls hack/create_worktree.sh for each task

set -e  # Exit on any error

# Array of task names for worktree creation
declare -a TASK_NAMES=(
    "session_sorting_priority"
    "tab_switching_navigation" 
    "session_detail_scrolling"
    "message_count_display"
    "extra_header_text_fix"
    "working_directory_inheritance"
)

# Main execution
echo "🌳 Creating 6 worktrees for TUI fix tasks..."
echo ""

SUCCESSFUL_WORKTREES=()
FAILED_WORKTREES=()

# Create worktrees sequentially using the existing script
for i in "${!TASK_NAMES[@]}"; do
    task_name="${TASK_NAMES[$i]}"
    worktree_name="tui_${task_name}"
    
    echo ""
    echo "========================================"
    echo "Creating worktree $((i+1))/6: ${task_name}"
    echo "========================================"
    
    # Just call the existing script that already works
    if hack/create_worktree.sh "$worktree_name"; then
        SUCCESSFUL_WORKTREES+=("$task_name")
    else
        FAILED_WORKTREES+=("$task_name")
        echo "❌ Worktree creation failed for ${task_name}, continuing with remaining tasks..."
    fi
done

echo ""
echo "========================================"
echo "Worktree Creation Summary"
echo "========================================"

if [ ${#SUCCESSFUL_WORKTREES[@]} -gt 0 ]; then
    echo "✅ Successfully created ${#SUCCESSFUL_WORKTREES[@]} worktrees:"
    for task_name in "${SUCCESSFUL_WORKTREES[@]}"; do
        echo "   ${task_name}"
    done
fi

if [ ${#FAILED_WORKTREES[@]} -gt 0 ]; then
    echo ""
    echo "❌ Failed to create ${#FAILED_WORKTREES[@]} worktrees:"
    for task_name in "${FAILED_WORKTREES[@]}"; do
        echo "   ${task_name}"
    done
fi

echo ""
if [ ${#SUCCESSFUL_WORKTREES[@]} -gt 0 ]; then
    echo "🚀 Ready to launch agents! Use ./launch_agents.sh to start working on the tasks."
else
    echo "❌ No worktrees were created successfully. Check the errors above."
    exit 1
fi