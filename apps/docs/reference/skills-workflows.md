# Skills and workflows reference

This page lists the exact behavior of each skill. Use the [workflow guide](/guide/skills-workflows) to choose and run a workflow. Read [How workflow phases fit together](/explanation/workflow-phases) for the reasons behind the phase model.

Some skills give focused work to sub-agents. See [Sub-agent models and effort](/reference/subagent-models) for each Claude Code and Codex child.

## Workflow choices

The task form offers four choices:

| Workflow | Phases |
| --- | --- |
| RPI | Questions, research, design discussion, structure outline, implementation, PR |
| PRD-Oriented | Questions, research, PRD, TDD, structure outline, implementation, PR |
| Oneshot | Implementation, PR |
| Freeform | No fixed phases |

RPI goes from the structure outline to implementation. An older variant adds a detailed plan between these phases. It still works, but the task form does not list it as a separate option.

Guided RPI and PRD-Oriented tasks normally start with `/rpi:create-research-plan`. Oneshot starts implementation from `ticket.md`. Freeform does not set phases.

## Skill conventions

- User-facing commands look like `/rpi:<command-name>`.
- `create-*` commands write a new numbered artifact; `iterate-*` commands edit an existing one in place.
- The create and iterate forms of a phase share a workflow label.
- Iterate commands remain available, but they are not separate phases.
- Continue in the current session if enough context remains. Ask the model to update the artifact directly.
- Before you switch sessions, write every current decision from this session into the artifact.
- If an artifact needs more work and the current session has used much of its context, start a new session with the matching `/rpi:iterate-*` skill. Include your feedback in the prompt.
- When artifacts disagree, the later one wins. For questions about current behavior, the live code beats any document.
- Utility commands show up in the slash menu without being a phase in any workflow.

```text
/rpi:iterate-design-discussion include the retry limit we agreed on and resolve the open queue question
```

## Skill catalog

The 22 skills below follow the registry phase order. Every entry uses the same six fields.

## Research questions

| Command | Main result |
| --- | --- |
| `/rpi:create-research-plan` | New research-questions artifact |
| `/rpi:iterate-research-questions` | Revised research-questions artifact |

### `/rpi:create-research-plan`

What it does: Turns a ticket or named source material into focused questions about the current codebase.

When to use it: At the start of a guided RPI or PRD-Oriented task. You can also use it when a broad request needs a clear research scope.

```text
/rpi:create-research-plan find how task retries work today before we design changes
```

What it reads: The ticket and the links, paths, packages, or images that you name. It does not read unrelated task history by default.

How it runs: Reads the named inputs in full. It checks the nearby context and keeps exact source pointers. It writes questions about the current system without a review checkpoint.

What you get: A new `NN-research-questions-<slug>.md` artifact.

Next step: `/rpi:create-research`.

### `/rpi:iterate-research-questions`

What it does: Improves the scope, wording, or context pointers of an existing question set.

When to use it: In a new session, when review finds missing, unclear, forward-looking, or misplaced questions.

```text
/rpi:iterate-research-questions add questions about retry limits and remove the proposed-solution question
```

What it reads: One research-questions artifact and your feedback. It reads ticket feedback when you point to it. If several question files can apply, it asks you to select one.

How it runs: Checks the target and your feedback. It keeps the questions about the current state and edits the file in place. It asks you to select the target only when the target is unclear.

What you get: The same artifact, updated in place with its frontmatter intact.

Next step: `/rpi:create-research`.

## Research

| Command | Main result |
| --- | --- |
| `/rpi:create-research` | New current-state research artifact |
| `/rpi:iterate-research` | Revised research artifact |

### `/rpi:create-research`

What it does: Answers a research question with facts from the live codebase and its tests.

When to use it: When a question artifact exists or you have a direct, bounded research request.

```text
/rpi:create-research answer the retry questions in the current task
```

What it reads: Exactly one research-questions artifact or a direct query. It skips `ticket.md` and unrelated artifacts unless you name them.

How it runs: Splits the work and uses parallel research when useful. It waits for every result. It then writes one objective account with code and test references. It can do one more check of open questions. If several question artifacts can apply, it asks you to select one.

What you get: A new `NN-research-<slug>.md` artifact.

Next step: `/rpi:create-design-discussion` for RPI, or `/rpi:create-prd` for PRD-Oriented.

### `/rpi:iterate-research`

What it does: Corrects or extends an existing research report.

When to use it: In a new session, when new feedback, missed code paths, or changed facts call for another look.

```text
/rpi:iterate-research check the worker shutdown path and add what the first report missed
```

What it reads: One research artifact and your feedback. It skips the question document, the ticket, and unrelated artifacts unless you name them.

How it runs: Checks your feedback against the code. It does more research when needed and adds the facts to the existing sections. It does not add an edit log. If several research files can apply, it asks you to select one.

What you get: The same research artifact, updated in place.

Next step: `/rpi:create-design-discussion`, or `/rpi:create-prd` for PRD-Oriented work.

## Design discussion

| Command | Main result |
| --- | --- |
| `/rpi:create-design-discussion` | New design decision artifact |
| `/rpi:iterate-design-discussion` | Revised decisions in place |

### `/rpi:create-design-discussion`

What it does: Turns research findings into clear options and user-owned design decisions.

When to use it: When RPI research is done but the design still has open choices.

```text
/rpi:create-design-discussion design the retry behavior from the completed research
```

What it reads: The ticket, the finished research, and other relevant task files. It does not read the research-questions artifact.

How it runs: Checks the context and fills research gaps when needed. It then writes the current state, desired state, options, and open questions. Each decision stays open until you give a clear answer.

What you get: A new `NN-design-discussion-<slug>.md` artifact.

Next step: Once the key decisions are settled, `/rpi:create-outline`.

### `/rpi:iterate-design-discussion`

What it does: Applies your feedback and settles open choices in an existing design discussion.

When to use it: In a new session, when you need to record a picked option, a correction, or a design change.

```text
/rpi:iterate-design-discussion use capped exponential backoff and resolve that choice
```

What it reads: The design discussion, relevant task history, and your feedback.

How it runs: Asks for feedback when you gave none. It checks claims against the code and updates the architecture and options. It resolves a question only after you settle it.

What you get: The same design discussion, updated in place.

Next step: Once everything is resolved, `/rpi:create-outline`.

## PRD

| Command | Main result |
| --- | --- |
| `/rpi:create-prd` | New product design artifact and optional mockups |
| `/rpi:iterate-prd` | Revised product design and mockups |

### `/rpi:create-prd`

What it does: Defines the product problem, success measure, and approved solution. It records the product WHAT and WHY.

When to use it: For PRD-Oriented work or when product behavior needs approval before technical design.

```text
/rpi:create-prd define the user experience for retrying failed tasks
```

What it reads: A ticket, research, a design discussion, or just a short prompt. It needs no upstream artifact and skips research-questions files.

How it runs: Writes a small document structure. It asks one question per message about the problem, success measure, and solution. You approve the full solution. It can render HTML mockups for visual choices.

What you get: A new `NN-prd-<slug>.md` artifact, plus `mockup-<description>.html` files when mockups come up.

Next step: `/rpi:create-tdd`.

### `/rpi:iterate-prd`

What it does: Revises an existing PRD without breaking its artifact link.

When to use it: In a new session, when product feedback changes a settled choice, the success measure, the scope, or a mockup.

```text
/rpi:iterate-prd make manual retry part of the first release and update the success measure
```

What it reads: The PRD, task context, your feedback, and any related mockups.

How it runs: Applies one change at a time. It updates the PRD and mockups, then waits for your next call. It finishes when you approve the solution.

What you get: The same PRD and any affected mockups.

Next step: `/rpi:create-tdd`.

## TDD

| Command | Main result |
| --- | --- |
| `/rpi:create-tdd` | New technical design artifact and optional diagrams |
| `/rpi:iterate-tdd` | Revised technical design and diagrams |

### `/rpi:create-tdd`

What it does: Defines the technical HOW, from behavior between components to code shape and test seams.

When to use it: When a product design needs an approved technical design before the work gets split into phases.

```text
/rpi:create-tdd design the retry service from the approved PRD
```

What it reads: A PRD, a ticket plus research, or short product context. A PRD helps but is not required; research-questions files are skipped.

How it runs: Writes a document structure. It asks one System Design question per message, then asks for approval. It repeats this process for Program Design and asks for a second approval. It can render diagrams to support a choice.

What you get: A new `NN-tdd-<slug>.md` artifact, plus optional `diagram-<description>.html` files.

Next step: `/rpi:create-outline`.

### `/rpi:iterate-tdd`

What it does: Applies technical feedback while keeping the system and program designs in step.

When to use it: In a new session, when a technical choice, interface, code seam, test approach, or diagram needs to change.

```text
/rpi:iterate-tdd move retry scheduling into the worker service and update the tests
```

What it reads: The TDD, the relevant upstream artifacts, your feedback, and any supporting diagrams.

How it runs: Resolves one technical choice at a time. It keeps System Design and Program Design separate. It updates product artifacts when the change affects user-visible behavior.

What you get: The updated TDD, its diagrams, and any product artifact that had to follow a behavior change.

Next step: `/rpi:create-outline`.

## Structure outline

| Command | Main result |
| --- | --- |
| `/rpi:create-outline` | New phased implementation outline |
| `/rpi:iterate-outline` | Revised outline in place |

### `/rpi:create-outline`

What it does: Splits an approved design into ordered vertical phases you can test one at a time.

When to use it: When the design decisions are settled and the work is ready to shape for implementation.

```text
/rpi:create-outline split the approved retry design into testable phases
```

What it reads: Every relevant task artifact except research questions, plus the source files those artifacts cite.

How it runs: Researches remaining gaps. It defines each phase's scope, files, tests, automated checks, and manual checks. It copies the phases to an overview checklist. Feedback changes the outline and does not start implementation.

What you get: A new `NN-structure-outline-<slug>.md` artifact.

Next step: `/rpi:create-worktree` if worktree timing is Later; otherwise `/rpi:implement-outline`.

### `/rpi:iterate-outline`

What it does: Fixes phase boundaries, order, files, or checks before implementation starts.

When to use it: In a new session, when review finds scope gaps, a bad phase order, missing validation, or unresolved questions.

```text
/rpi:iterate-outline move the migration before the worker changes and add rollback checks
```

What it reads: The outline, the earlier ticket, research, design, PRD, or TDD artifacts, and your feedback.

How it runs: Asks for feedback when you gave none. It checks the feedback and revises the phase order, scope, files, checks, and open questions in place.

What you get: The same structure outline, updated in place.

Next step: `/rpi:create-worktree` if worktree timing is Later; otherwise `/rpi:implement-outline`.

## Detailed plan and legacy RPI

The current RPI and PRD-Oriented options skip the detailed plan. These commands still work for the older `rpi` flow. They also support users who want code-level steps between the outline and implementation.

| Command | Main result |
| --- | --- |
| `/rpi:create-plan` | New detailed implementation plan |
| `/rpi:iterate-plan` | Revised detailed plan |

### `/rpi:create-plan`

What it does: Expands each outline phase into exact code changes and checks.

When to use it: On the detailed-plan path, or when you want code-level instructions before implementation.

```text
/rpi:create-plan expand the retry outline into exact code and test steps
```

What it reads: The full task history except research questions. The structure outline and its source files have the highest priority.

How it runs: Expands each phase into exact steps and checks. It then checks the workspace configuration and current worktree state. Implementation normally pauses for your review between phases.

What you get: A new `NN-plan-<slug>.md` artifact.

Next step: `/rpi:create-worktree` if setup is deferred; otherwise `/rpi:implement-plan`.

### `/rpi:iterate-plan`

What it does: Corrects or refines the plan's steps and checks.

When to use it: In a new session, when plan review finds a wrong approach, file list, phase detail, or validation step.

```text
/rpi:iterate-plan replace the polling step with the existing queue helper
```

What it reads: The plan, all relevant earlier artifacts, the source files they reference, and your feedback.

How it runs: Checks the corrections against the code. It edits the phases and checks without changing the metadata. It then checks the workspace state for the handoff.

What you get: The same plan, updated in place.

Next step: `/rpi:create-worktree` if needed; otherwise `/rpi:implement-plan`.

## Workspace and implementation

| Command | Main result |
| --- | --- |
| `/rpi:configure-workspace` | Workspace configuration |
| `/rpi:create-worktree` | Task worktree or multi-repo workspace |
| `/rpi:implement-plan` | Code, tests, commits, and plan progress |
| `/rpi:implement-outline` | Code, tests, commits, and outline progress |
| `/rpi:iterate-implementation` | Fixes to implemented code and tests |

### `/rpi:configure-workspace`

What it does: Sets the shared and local rules HumanLayer uses to create task workspaces.

When to use it: When a repository has no workspace configuration. You can also use it to change repositories, branches, setup commands, or copy rules.

```text
/rpi:configure-workspace add the API and UI repositories to this workspace
```

What it reads: The repository layout, remotes, workspace files, build files, setup files, and your answers about local needs.

How it runs: Checks the repositories. It asks about the primary repository, source ref, setup commands, copied files, and local overrides. It checks the result and asks before it writes files.

What you get: `.humanlayer/workspace.json`, an optional `.humanlayer/workspace.local.json`, and an optional `.gitignore` entry.

Next step: Back to task creation, or `/rpi:create-worktree`. See [Workspace setup](/guide/workspaces).

### `/rpi:create-worktree`

What it does: Creates the task's configured worktree or multi-repo workspace.

When to use it: When worktree timing is Later, or when you want a fresh workspace for an existing task.

```text
/rpi:create-worktree create the workspace for the current task
```

What it reads: Workspace config, the task slug, the ticket or outline, repository state, and any legacy worktree script the repo still uses.

How it runs: Stops when setup is disabled or a workspace exists. You can explicitly ask for another workspace. Otherwise it resolves the configuration and creates branches and worktrees. It then copies files and runs setup commands. A setup error blocks completion.

```text
/rpi:create-worktree create another clean workspace for this task
```

What you get: Worktrees, task branches, copied files, setup results, and sometimes generated workspace config.

Next step: `/rpi:implement-outline` for RPI and PRD-Oriented work, or `/rpi:implement-plan` on the detailed-plan path.

### `/rpi:implement-plan`

What it does: Implements a detailed plan. For Oneshot, it implements `ticket.md` directly.

When to use it: When a detailed plan exists or when an Oneshot task starts without one.

```text
/rpi:implement-plan implement Phase 1 and stop for review
```

What it reads: The plan you name, or the task directory that holds one. On the Oneshot path, the launch prompt points it at the ticket instead.

How it runs: Implements and checks one phase at a time. It reports manual steps, waits for approval, and commits the phase. When you request several phases, it waits after the full group. Auto-advance runs all phases without a pause but still commits each phase.

```text
/rpi:implement-plan implement phases 1 through 3, committing each phase, then stop for review
```

What you get: Code, tests, commits, and checked-off plan items.

Next step: `/rpi:describe-pr`.

### `/rpi:implement-outline`

What it does: Implements an RPI or PRD-Oriented task straight from the structure outline.

When to use it: When an approved outline exists and no detailed plan is needed.

```text
/rpi:implement-outline just do all the phases, committing as you go, and I'll check it at the end
```

What it reads: The structure outline plus the relevant research and design context.

How it runs: Implements and checks one incomplete phase at a time. It reports manual steps, waits for review, and commits the phase. It records progress in the outline. It never creates or calls a detailed plan. Auto-advance runs all phases without a pause but still commits each phase.

What you get: Code, tests, commits, checked validation items, and completed phase headings in the outline.

Next step: `/rpi:describe-pr`.

### `/rpi:iterate-implementation`

What it does: Applies bug reports or review feedback to work that is already underway.

When to use it: In a new session, when the built behavior is wrong, tests need updates, or review asks for a change.

```text
/rpi:iterate-implementation fix retries after worker restarts and add a regression test
```

What it reads: The feedback, current diff, commits, and relevant task artifacts.

How it runs: Compares the required behavior with the code. It sends wholly unstarted phases to the normal implementation flow. It checks reported problems, applies fixes, and runs checks. It asks you when it cannot reproduce a problem or the required approach is unclear.

What you get: Fixed code and tests.

Next step: `/rpi:describe-pr` once the changes are ready.

## PR and commit

| Command | Main result |
| --- | --- |
| `/rpi:describe-pr` | Created or updated GitHub PR and saved description |
| `/rpi:ci-commit` | One or more focused commits |

### `/rpi:describe-pr`

What it does: Creates or updates the task's pull request from the full branch diff and the task context.

When to use it: When implementation is done and the branch is ready for review.

```text
/rpi:describe-pr open the pull request and include the checks we ran
```

What it reads: The current branch and pull request state, full base diff, repository metadata, task artifacts, plan, and available task links.

How it runs: Finds the task's pull request or creates one when branch ownership is clear. It commits and pushes work when needed. It reads the full diff and compares it with the plan. It writes the body and updates GitHub. It asks only when it cannot safely identify or create the pull request.

What you get: A GitHub pull request, `pr-description.md`, and for a large change an optional `pr-walkthrough.html`.

Next step: None. This is the last RPI command. Continue with normal pull request review.

### `/rpi:ci-commit`

What it does: Turns the relevant working-tree changes into focused commits.

When to use it: When you want a clean commit without a full implementation or PR flow.

```text
/rpi:ci-commit commit the retry tests separately from the worker changes
```

What it reads: Git status, staged and unstaged diffs, untracked files, and the repo's recent commit-message style.

How it runs: Groups the relevant changes. It does not commit files that look like secrets. It stages files by name, commits, and checks the result. It normally runs without an approval checkpoint.

What you get: One or more focused git commits.

Next step: No fixed command. Continue implementation or run `/rpi:describe-pr`.

## Standalone review

| Command | Main result |
| --- | --- |
| `/rpi:review-artifact-comments` | Artifact edits and comment actions |

### `/rpi:review-artifact-comments`

What it does: Reviews and acts on comments left on a saved task artifact.

When to use it: When a reviewer leaves cloud comments. Use it to reply, resolve, delete, restore, or edit the artifact.

```text
/rpi:review-artifact-comments apply the open comments on the design discussion
```

What it reads: The comment data you supply, an artifact path, or enough task context to find both.

How it runs: Loads the artifact and its comments. It asks for an action when you did not give one. It handles one comment at a time. It edits, resolves, checks, replies, or changes comment state as you direct.

What you get: Updated artifact content, comment state changes, and replies.

Next step: No fixed command. Return to the phase that owns the artifact.

## Command names

Use the commands in the first column. An older name can still appear in the HumanLayer UI and invokes the same skill with the same behavior.

| Command | Older UI name |
| --- | --- |
| `/rpi:create-worktree` | `/rpi:setup-worktree` |
| `/rpi:configure-workspace` | `/rpi:configure-workspaces` |
| `/rpi:create-research-plan` | `/rpi:create-research-questions` |
| `/rpi:create-outline` | `/rpi:create-structure-outline` |
| `/rpi:iterate-outline` | `/rpi:iterate-structure-outline` |

## Artifacts and precedence

### Numbering and filenames

A create skill finds the highest `NN-` prefix in the task directory and uses the next number. Numbering applies to all artifact types. Existing artifacts therefore control the exact number. Iterate skills keep the path and frontmatter.

```text
.humanlayer/tasks/<task-slug>/
  01-research-questions-<slug>.md
  02-research-<slug>.md
  03-design-discussion-<slug>.md   # RPI path
  03-prd-<slug>.md                 # PRD-Oriented alternative
  04-tdd-<slug>.md
  05-structure-outline-<slug>.md
  06-plan-<slug>.md                # detailed-plan path only
  mockup-<description>.html        # optional PRD support
  diagram-<description>.html       # optional TDD support
  pr-description.md
  pr-walkthrough.html              # optional large-PR support
```

### Artifact roles

| Artifact | What it owns |
| --- | --- |
| Research questions | Current-state questions and exact context pointers |
| Research | Objective findings from code, tests, and named sources |
| Design discussion | Options and user-resolved design choices |
| PRD | Product problem, success measure, WHAT, and WHY |
| TDD | Technical HOW across system and program design |
| Structure outline | Vertical implementation phases and their checks |
| Plan | Exact code-level steps for the detailed-plan path |
| PR description | Review summary, changes, and validation |

When two artifacts disagree, the later design artifact usually wins:

```text
plan > structure outline > TDD > PRD > design discussion > research > ticket
```

Not every workflow creates every item in this chain. During current-state research, live code takes priority over written summaries.

### User checkpoints

- Design discussion decisions stay open until you clearly settle them.
- The PRD asks one product question per message. It needs your approval of the full solution.
- The TDD asks one technical question per message. It needs separate approval for System Design and Program Design.
- Feedback on an outline or plan revises the document — it never starts implementation.
- Normal implementation reports its checks and manual steps. It waits for review, commits, and then moves to the next phase.
- Auto-advanced implementation skips those pauses but still commits after every phase.

### Artifact comments

Saved artifacts can contain cloud comments without changes to their Markdown. Use `/rpi:review-artifact-comments` to act on a comment or edit the artifact. The skill handles one comment at a time. Each action is explicit.

## Worktree timing

| Timing | Task creation | Handoff before implementation |
| --- | --- | --- |
| Now | Creates the configured workspace before your first session and starts in its primary repo | The outline hands off straight to `/rpi:implement-outline`; a detailed plan hands off to `/rpi:implement-plan` |
| Later | Starts in your current directory | Adds a real `/rpi:create-worktree` phase before implementation |
| Never | Creates no task worktree | The outline or plan hands off straight to its implementation command |

Oneshot treats **Later** as **Never**. Selecting **Now** still creates the workspace. When setup is deferred, the setup step can report the new working directory. The next session can then start in the correct worktree.

## Next steps and auto-advance

When a skill finishes, its final message names the next command. HumanLayer can show this command as the next action. If auto-advance is on and the phase is complete, HumanLayer starts the next session.

Auto-advance covers these transitions:

| Completed phase | Next phase | Notes |
| --- | --- | --- |
| Research questions | Research | Needs the research-questions artifact |
| Research | Design discussion or PRD | Target follows the selected workflow |
| Detailed plan | Worktree setup or implementation | Legacy detailed-plan path; target follows worktree timing |
| Worktree setup | Implementation | Uses the workflow's implementation mode |
| Implementation | PR | Starts `/rpi:describe-pr` |

Auto-advance does not cover design discussion to outline, PRD to TDD, TDD to outline, or outline to implementation. These handoffs show a command and wait for you. Auto-advance does not create a duplicate newer phase. Each transition turns itself off after it runs.

## Implementation modes

All implementation commands share the Implementation phase label. Each command has a different job:

| Mode | Command | Source of work | Progress record |
| --- | --- | --- | --- |
| Outline implementation | `/rpi:implement-outline` | Structure outline | Outline phase headings and validation checkboxes |
| Detailed-plan implementation | `/rpi:implement-plan` | Numbered plan artifact | Plan checklist items |
| Oneshot implementation | `/rpi:implement-plan` | `ticket.md`, with launch instructions that no plan exists | Code, tests, and commits |
| Implementation revision | `/rpi:iterate-implementation` | Feedback plus current code and task context | Revised code and tests |

Outline implementation never calls `create-plan` or `implement-plan`. Outline and plan modes normally work one phase at a time. They run checks, report manual validation, wait for approval, and commit. Auto-advance removes the pause but still commits each phase.

## PR output

`/rpi:describe-pr` runs as the final agent phase. It is not a background GitHub action. It:

1. Finds the pull request for the current branch, or creates one when that is safe.
2. Commits relevant task work when ownership is clear, and pushes if the branch has no upstream.
3. Reads the whole diff against the base branch and checks it against the task artifacts.
4. Writes `pr-description.md` and uses it as the GitHub PR body.
5. Adds `pr-walkthrough.html` when the PR touches at least 300 lines across at least five files.

The walkthrough contains task context, ordered implementation steps, diff excerpts, links, exclusions, and check results. Reviewers can use it to check a large change.

## Maintainer note

These pages are hand-written. When the skills change, check the ordered registry in `packages/ui/src/constants/rpi-skills.ts` and the skill definitions in `apps/riptide-rpi-claude-plugin/skills/` before updating this catalog.
