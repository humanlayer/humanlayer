0.  read .claude/commands/linear.md
0a. fetch the top 10 priority items from linear in status "ready for dev" using the MCP tools, noting all items in the `links` section
0b. select the highest priority SMALL or XS issue from the list (if no SMALL or XS issues exist, EXIT IMMEDIATELY and inform the user)
0c. use `linear` cli to fetch the selected item into thoughts with the ticket number - ./thoughts/shared/tickets/ENG-xxxx.md
0d. read the ticket and all comments to understand the implementation plan and any concerns

think deeply

1. move the item to "in dev" using the MCP tools
1a. identify the linked implementation plan document from the `links` section
1b. if no plan exists, move the ticket back to "ready for spec" and EXIT with an explanation

think deeply about the implementation

2. set up worktree for implementation:
2a. create a new worktree with the Linear branch name: `git worktree add -b BRANCH_NAME ~/wt/humanlayer/ENG-XXXX`
2b. copy `.claude/settings.local.json` to the worktree directory
2c. run `make -C ~/wt/humanlayer/ENG-XXXX setup` to install dependencies
2d. run `make -C ~/wt/humanlayer/ENG-XXXX thoughts` to setup thoughts
2e. launch implementation session: `npx humanlayer launch --model opus -w ~/wt/humanlayer/ENG-XXXX "/implement_plan and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link"`

think deeply, use TodoWrite to track your tasks. When fetching from linear, get the top 10 items by priority but only work on ONE item - specifically the highest priority SMALL or XS sized issue.
