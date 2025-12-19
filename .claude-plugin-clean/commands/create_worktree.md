
---
description: Create worktree and launch implementation session for a plan
---

2. set up worktree for implementation:
2a. read `hack/create_worktree.sh` and create a new worktree with the branch name: `./hack/create_worktree.sh TICKET_ID BRANCH_NAME`

3. determine required data:

branch name
path to plan file (use relative path only)
launch prompt
command to run

**IMPORTANT PATH USAGE:**
- The thoughts/ directory is synced between the main repo and worktrees
- Always use ONLY the relative path starting with `thoughts/shared/...` without any directory prefix
- Example: `thoughts/shared/plans/fix-mcp-keepalive-proper.md` (not the full absolute path)
- This works because thoughts are synced and accessible from the worktree

3a. confirm with the user by sending a message to the Human

```
based on the input, I plan to create a worktree with the following details:

worktree path: ~/wt/humanlayer/TICKET_ID
branch name: BRANCH_NAME
path to plan file: $FILEPATH
launch prompt:

    /implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR

command to run:

    humanlayer launch --model opus -w ~/wt/humanlayer/TICKET_ID "/implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR"
```

incorporate any user feedback then:

4. launch implementation session: `humanlayer launch --model opus -w ~/wt/humanlayer/TICKET_ID "/implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR"`
