---
description: Create a new worktree for parallel development work
---

# Create Worktree

You are tasked with creating a new git worktree for parallel development work.

## Process

1. **Create the worktree**:
   - Run `./hack/create_worktree.sh` with no arguments to auto-generate a name
   - The script will:
     - Generate a unique name (e.g., `swift_fix_1430`)
     - Create the worktree at `~/wt/humanlayer/{name}/`
     - Copy `.claude` directory
     - Run `make setup`
     - Initialize thoughts

2. **Capture the worktree path**:
   - Note the path from the script output (e.g., `~/wt/humanlayer/swift_fix_1430`)

3. **Launch a session in the worktree**:
   - Run: `humanlayer launch -w {WORKTREE_PATH} "Your task prompt here"`
   - Or if already in a Claude session, inform the user of the worktree location

## Example

```bash
# Create worktree
./hack/create_worktree.sh
# Output: ✅ Worktree created successfully!
# Output: 📁 Path: /Users/you/wt/humanlayer/swift_fix_1430

# Launch session in worktree
humanlayer launch -w ~/wt/humanlayer/swift_fix_1430 "Implement the feature"
```

## Notes

- The `thoughts/` directory is synced between worktrees
- To clean up later: `./hack/cleanup_worktree.sh {worktree_name}`
- You can also specify a custom name: `./hack/create_worktree.sh my_feature_name`
