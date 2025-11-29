
---
description: Create worktree and launch implementation session for a plan
---

1. determine worktree base path:
1a. Ask the user if they want to use a custom worktree base path via `HUMANLAYER_WORKTREE_OVERRIDE_BASE`
   - Default is `~/wt` if not set
   - If user provides a custom path, export it before running create_worktree.sh: `export HUMANLAYER_WORKTREE_OVERRIDE_BASE=/custom/path`
   - The create_worktree.sh script will use `$HUMANLAYER_WORKTREE_OVERRIDE_BASE/$REPO_NAME/` as the base

2. set up worktree for implementation:
2a. If $REPO_NAME is `humanlayer` you should read from `hack/create_worktree.sh` if not read create_worktree.sh (i.e. it should be availaible via the PATH) and create a new worktree with the Linear branch name using : `./hack/create_worktree.sh ENG-XXXX BRANCH_NAME` OR `create_worktree.sh ENG-XXXX BRANCH_NAME'. Accordingly pass the --no-setup option if the repo is not humanlayer. If create_worktree.sh is not available halt and tell the user you cannot find this executable and cannot go on.

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

worktree base: ${HUMANLAYER_WORKTREE_OVERRIDE_BASE:-~/wt}
worktree path: ${HUMANLAYER_WORKTREE_OVERRIDE_BASE:-~/wt}/$REPO_NAME/ENG-XXXX
branch name: BRANCH_NAME
path to plan file: $FILEPATH
launch prompt:

    /implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link

command to run:

    humanlayer launch --model opus -w ${HUMANLAYER_WORKTREE_OVERRIDE_BASE:-~/wt}/$REPO_NAME/ENG-XXXX "/implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link"
```

incorporate any user feedback then:

4. launch implementation session: `humanlayer launch --model opus -w ${HUMANLAYER_WORKTREE_OVERRIDE_BASE:-~/wt}/$REPO_NAME/ENG-XXXX "/implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link"`
