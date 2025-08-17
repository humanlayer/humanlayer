
2. set up worktree for implementation:
2a. read `hack/create_worktree.sh` and create a new worktree with the Linear branch name: `./hack/create_worktree.sh ENG-XXXX BRANCH_NAME`

3. determine required data:

branch name
path to plan file
launch prompt
command to run

3a. confirm with the user by sending a message to the Human

```
based on the input, I plan to create a worktree with the following details:

worktree path: ~/wt/humanlayer/ENG-XXXX
branch name: BRANCH_NAME
path to plan file: $FILEPATH
launch prompt:

    /implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link

command to run:

    npx humanlayer launch --model opus -w ~/wt/humanlayer/ENG-XXXX "/implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link"

```


4. launch implementation session: `npx humanlayer launch --model opus -w ~/wt/humanlayer/ENG-XXXX "/implement_plan at $FILEPATH and when you are done implementing and all tests pass, read ./claude/commands/commit.md and create a commit, then read ./claude/commands/describe_pr.md and create a PR, then add a comment to the Linear ticket with the PR link"`
