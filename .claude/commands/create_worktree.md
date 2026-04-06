---
description: Create a git worktree and prepare an implementation session for a plan
---

# Create Worktree

You are tasked with creating a git worktree for isolated implementation of a plan.

## Steps

1. **Ask for required information** (if not already provided):
   - Path to the plan file (e.g. `thoughts/plans/2025-01-08-description.md`)
   - Branch name for the implementation (e.g. `feature/short-description`)

2. **Read the plan file** to understand the scope.

3. **Determine the worktree path:**
   - Use `~/wt/BRANCH_NAME` as the default location (e.g. `~/wt/feature-short-description`)

4. **Confirm with the user before creating:**
   ```
   Based on the input, I plan to create a worktree with the following details:

   Worktree path: ~/wt/BRANCH_NAME
   Branch name:   BRANCH_NAME
   Plan file:     thoughts/plans/YYYY-MM-DD-description.md

   Command to run:
     git worktree add ~/wt/BRANCH_NAME -b BRANCH_NAME
   ```

5. **Create the worktree** after user confirmation:
   ```bash
   git worktree add ~/wt/BRANCH_NAME -b BRANCH_NAME
   ```

6. **Provide next steps** to the user:
   ```
   Worktree created at ~/wt/BRANCH_NAME

   To start implementation:
   1. Open a new Claude Code session in the worktree:
        cd ~/wt/BRANCH_NAME && claude
   2. In the new session, run:
        /implement_plan at thoughts/plans/YYYY-MM-DD-description.md
   3. When done: /commit then /describe_pr
   ```

## Important Notes

- Always confirm with the user before running git commands
- Use only relative paths starting with `thoughts/` when referencing plan files — worktrees share the same `thoughts/` directory
- Worktrees share the same git history — commits in the worktree are immediately visible in the main repo
- To clean up after merging: `git worktree remove ~/wt/BRANCH_NAME`
