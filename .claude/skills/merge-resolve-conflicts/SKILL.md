---
name: merge-resolve-conflicts
description: Use to merge in main and resolve open merge conflicts.
---

You are either on a branch in a repository, or you are on a git worktree for a specific branch.
You are responsible for ensuring the default branch (usually `main` or `master`, but not always) is merged into the current branch.

Begin by running `git fetch`.

Then:

## Step 1: Orientation

First, you must determine if you are on a worktree for a repository OR if you are on a regular branch on a repository OR if you are on the default branch for the repository

Second, you must determine if the branch you are on has changes on `upstream` / `origin` (as configured) that you do not have on your local branch

Third, you should determine if there are existing merge conflicts on your branch already by running `git status`.

Fourth, you should determine if the user has both an **origin** _and_ an **upstream** configured.

**Important**: if the user is working across multiple repositories, you should ask them which repository(ies) they would like help merging in.


## Step 2: Action

Depending on the results of your orientation you should take one of the following actions:

* **If the user has unstaged changes which do not include merge conflicts or an ongoing merge**: offer to either stash and merge, or to commit before merging, Then proceed with the following once the user answers:
* **If there are existing merge conflicts on your current branch**: proceed to "Conflict Resolution Procedure" and follow those instructions.
* **If you are on a worktree or branch which is _not_ for the default branch, and there are no merge conflicts**:
  * **if the user has both upstream and origin configured**: fetch the defualt branch from the **upstream** and then merge it into the current branch. Proceed to the "conflict resolution procedure" steps.
  * **if the user has only origin configured**: fetch the default branch from the origin and merge it into the current branch. Proceed to the "Conflict resolution procedure" steps.
* **If you are on the default branch and there are no merge conflicts and no changes on origin/upstream**: Indicate this to the user and ask what they would like you to do.


## Conflict Resolution Procedure
1. Read the `ticket.md` and structure outline artifacts. These should contain sufficient context about the user's task and what they are working on. You may _later_ read the plan file if you determine that more information is needed.
2. Use sub-agents to analyze the git state on the current branch and on the branch the conflicts come from to understand what was done and why they diverge.
3. Use sub-agents to read the _entire_ file for each conflict, as well as key relevant code and modules to understand the scope and nature of each conflict
4. For each conflict (not necessarily each _individual_ confict, e.g. group two related conflicts in the same file together e.g. for a function change and an import change for it), provide an analysis to the user of:
  a. What is on HEAD
  b. What is on the branch that the conflict is coming from (probably `main` or the other default branch)
  c. Based on the scope of the current task, recent commits to it and to the branch where the source of the conflict is coming from, how you recommend resolving it (keep HEAD, keep other branch, merge them), and why
Keep your analysis concise, offer to provide more detail to the user if they ask.
5. Ask the user how they would like to proceed for each one.
6. Work back and forth with the user to resolve all conflicts. Only make changes that the user explicitly asks for - e.g. do not resolve a conflict until the user confirms the approach or instructs you to make the change.
7. Once all merge conflicts are resolved, ask the user if they would like you to commit and push. If they confirm, you should write a conventional commit-style message indicating the branch merged in (from what commit hash), and a full body that indicates what each of the conflicts resolved was and how it was resolved and why.

**IMPORTANT**: Update your todo list to include items 1-7. You _MUST_ stop and ask the user how they would like to proceed after presenting the analysis from step 4. You MUST work back and forth with the user until all conflicts have been resolved before proceeding to stop 7. The user may only give you instructions / guidance on _some_ of the changes at a time - you should use the todo tool to track which ones have been completed and which ones still need resolution in your todo list.