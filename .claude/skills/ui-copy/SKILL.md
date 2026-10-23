---
name: ui-copy
description: |
  Copy rules for every user-visible string in riptide-ui, riptide-cloud, packages/ui, and
  server strings that reach a toast. ACTIVATE when adding, changing, or reviewing a button,
  menu item, dialog, toast, error, empty state, placeholder, tooltip, aria-label, setting,
  hotkey description, banner, or onboarding text. Not for apps/docs, the CLI, or comments.
---

**First rule: write to the person, never about the system.** Every string answers "what does
this mean for me and what can I do now?", never "what state is the code in?". A string that
narrates internal state, preconditions, or implementation progress is a log line, not copy, even
when it is accurate. Before any rule below, reread the string as the user and ask what they would
do next.
`Workspace setup is running independently. No session has started.` → `Setting up your workspace. Your session starts when it finishes.`
`Worktree configuration is required to use "Now".` → `Add a workspace config to create worktrees now.`
`Task creation sync timed out` → `Could not confirm the task was created. Check the task list before retrying.`
`Comment sync still loading` → `Comments are loading`. `Workspace setup row is parked on an error` → `Workspace setup failed`. `Converging`, `Delivery rejected: …` → never.

Voice: a competent colleague at the next desk. Says the actual thing, names the key, admits
limits. Never apologizes, sells, or shouts. Model string:
`Updating will interrupt 3 active sessions on this device. Finish your work before updating, or choose` `Later`.

## Changing a string that already ships

Writing a new string: apply everything below. **Changing one that exists: read this first.**
A rule matching a line is not on its own a reason to rewrite it.

- **Two kinds of finding.** *Mechanical* — a raw enum, Title Case, `...`, `ENTER`, `(s)`,
  an internal name, `Failed to`, "please", a dead route. One right answer, no taste, fix it.
  *Voice* — hero lines, warnings, tips, empty states, anything with a deliberate point of view.
  Here the rule is a prompt to look, not a verdict.
- **Change the defect, not the sentence.** If one word is wrong, fix that word.
  `…how Riptide queries data… You probably don't want to mess with these.` needed
  Riptide → HumanLayer and nothing else.
- **If the rewrite is only more conformant, stop.** It must be clearer, more honest, or more
  useful *to the reader*. "Now it follows the guide" is not a benefit anyone experiences.
- **Never bulk-rewrite voice.** Mechanical findings batch; voice findings go one at a time,
  with the tension named, for a person to decide. An audit that proposes 180 rewrites has
  stopped reading and started matching.
- **Hero and marketing copy is out of scope** unless it is factually wrong. The install page
  and the composer headline are written on purpose.
- When you are unsure which kind you have, it is voice. Leave it and say why you looked.

## Mechanics

- Sentence case everywhere: buttons, titles, headings, menu items, labels, badges, tabs, toasts.
- Proper nouns keep casing: HumanLayer, HumanLayer Cloud, Claude Code, Codex, Fold, GitHub, Linear, Jira, Slack, Stripe, macOS, Starter/Pro/Enterprise, RPI, PRD, TDD.
- Feature names are common nouns: fast mode, bypass permissions, auto-accept edits, multiplayer prompting, advanced metrics, commit tracking.
- Never uppercase in the source string: write `Needs approval`, not `NEEDS_APPROVAL`; `DENY` → `Deny`. Rendering is then a CSS decision in one place, and **the default is not to uppercase**. The terminal-style caps on badges and eyebrows accreted rather than being designed, and the app reads better without them; keep them only where a surface earns it.
- Never render a raw enum (`needs_approval`, `xhigh`). Add a label map first.
- Full sentences end with a period. Fragments (buttons, labels, badges, placeholders, toast titles, headings, hotkey descriptions) do not.
- Ellipsis is `…`, only on in-progress labels: `Saving…`. Never `...`, never on placeholders.
- Em dash with spaces for a consequence. `·` between status facts (`This device · online`). `→` for sequences. `–` for ranges (`2–4×`). Oxford comma. Straight quotes.
- No `!`. `&` only in a compact two-verb button (`Interrupt & send`); prose uses "and". No `+` in prose.
- Address the user as "you".
- Actor: **you** do what you click (install the GitHub App, connect Linear, start a daemon). **The agent** does the work in a session (fixes, implements, opens a pull request). **HumanLayer** only does what happens on its own with no click (syncs, checks this device, sends a notification). Otherwise no subject: `Could not save draft`. `Connect GitHub so the agent can open pull requests.` `HumanLayer checks this device before your first task.`
- Never the **company "we"** — a faceless narrator reporting or apologising: `We couldn't fetch your organizations`, `Something went wrong on our end`, `we'll investigate`. Rewrite with no subject or with HumanLayer as the subject.
- The **collaborative "we"** — you and the agent, as a pair — is allowed, and only in the composer where that pairing is literally what is happening: `What should we build today?` stays. Do not extend it to status, errors, or settings.
- Never "please", "sorry", "successfully", "just", "simply", "Something went wrong", "Are you sure". No roadmap hedges: "currently", "not yet", "coming soon". `yet` in an empty-state fact (`No tasks yet`) is fine.
- **Do not sand off personality.** A line with a point of view is not a defect. `You probably don't want to mess with these` is doing a real job; flattening it to `Change these only when asked to` is the machine talking. Fix what is wrong in a line (an internal name, a raw enum) and leave the rest alone. If a rewrite is only blander, do not make it.
- Use contractions (`can't`, `don't`, `isn't`). The one exception is `cannot` in irreversibility warnings: `This action cannot be undone.`
- No internal names (Riptide, CodeLayer, Launcher V3, Projects V2, Phase 5, route paths, ISO timestamps, WorkOS).
- Digits, real plurals (`1 session`, `2 sessions`, never `(s)`), thousands separators. Zero is a word: `No sessions`, not `0 sessions`.
- Time: relative in lists (`3 min ago`, `yesterday`), absolute in the tooltip (`Sep 10, 2026, 15:04`), durations as `2m 3s`.
- Truncate the end of a title and the middle of a path (`~/code/…/riptide-ui`). Never truncate a number or a key.
- Keys: `⌘ ⇧ ⌥` / `Ctrl Shift Alt`, joined with `+`, `Enter`, `Esc`, uppercase letters. Always give the non-mac form. Never `Cmd`, `ENTER`, `↵`, `⌃`. A key is a keycap element next to the label, never typed into the label string. In this document a key shown after a label means a keycap.

## Session status labels

| value | label |
|---|---|
| draft | Draft |
| ready_for_launch | Queued |
| waiting_for_workspace | Preparing workspace |
| launching, resuming | Starting |
| running | Running |
| ready_for_input | Idle |
| needs_approval | Needs approval |
| interrupt_requested | Interrupting |
| interrupted | Interrupted |
| failed | Failed |
| lost | Stalled |

## Shapes

| type | shape | example |
|---|---|---|
| Button, menu item | verb + object; bare verb when the object is the dialog subject; in-flight = gerund + `…` | `Create task`, `Delete`, `Creating…`. Not `OK`, `Yes`, `Submit`, `Confirm`, `Got it` |
| Success toast | title = object + past participle; partial success: title names the win, description the miss | `Draft saved`. `Token created` / `The token list could not be refreshed.` |
| Error | 1 what happened `Could not <verb> <object>` 2 what it means for your work 3 what to do or an action button | `Could not send. Your draft was restored.` Not `Failed to`, `Unable to`, `Error`, `Unknown error` |
| Blocked state | the precondition as an instruction | `Connect a host to launch` |
| Integration prompt | `Connect <Product> to <payoff>`; payoff is one clause naming what appears or what the agent can do; optional cost hint as status facts | `Connect GitHub to see pull requests and checks here` · `about a minute · opens github.com` |
| Capability limit | limit + alternative | `Terminal is not available for sessions on remote hosts.` |
| Permission denial | who can fix it | `Only organization admins can manage billing. Ask an admin.` |
| Retry | only when it can succeed, with a how or when; never bare `Please try again.` | `Refresh billing and try again.` |
| Raw backend text | never a title; description or `Show details` | |
| Confirm dialog | title `<Verb> <object>?`; body = consequence, what is preserved, undoable?; confirm = title verb; `Cancel` + Esc; confirm = `⌘+Enter` | `Archive project?` / `Existing workspaces are not deleted.` / `Archive` |
| Reversible action | no dialog; undo toast | `Session archived` + `Undo` `Z` |
| Warning | list the consequences; never an intensifier | not `Use with extreme caution!` |
| Empty state | fact, then what fills it or what to do, with key | `No tasks yet` / `Create a task to organize your sessions` + `Create task` `T` |
| Loading | name the work or actor | `Creating worktrees…`, `Asking the agent…`; plain `Loading…` only when nothing more is true |
| Step list | short noun phrase; states `Pending / In progress / Complete / Failed / Skipped` | `Prepare launch` |
| Placeholder | noun phrase, instruction, or format example; no `…`, no period; a key hint is keycap + text | `Search tasks`, `you@company.com`, `ENG-123 or a Linear issue URL`, `Enter` `to start typing` |
| Setting label | noun phrase, not `Enable X` | `Default coding agent` |
| Setting description | one sentence: on, and off if not the obvious inverse; experiments say what changes and what does not | `Send all queued messages together as soon as the session is ready. Turn off to send one at a time.` |
| Org lock | | `Your organization has turned this off.` |
| Tooltip (icon button) | action label + keycap | `Toggle terminal` `⌘+T` |
| Tooltip (explainer) | one or two full sentences | |
| aria-label (control) | verb + object, no key, no period | `Copy file link` |
| aria-label (region) | noun phrase | `Document outline` |
| Toggle state (aria) | `{label}: on` / `: off` | |
| Hotkey description | verb + object, no article | `Open command palette`. Reuse `hotkeysCatalog.ts` wording |
| Banner | title fragment + one-sentence body; route non-admins to a person | `Payment overdue` / `Update billing details to avoid blocked writes.` |
| Notification toast | title = event; body = session or task; action = verb + key | `Needs approval` / `Jump to session` `⌘+⇧+J` |
| Money, rates | as charged | `$3.84 / commit`, `2–4×` |

## Glossary

| concept | use | not |
|---|---|---|
| product | HumanLayer; HumanLayer Cloud | Riptide, CodeLayer, Codelayer, the app, the application |
| unit of work | task | ticket (= the Linear/Jira issue), project |
| one agent run | session | conversation, chat, run |
| unlaunched task/session | draft, `Untitled draft` | Untitled session |
| reusable repo recipe | project | workspace, recipe |
| session output document | artifact | document, doc, file |
| repo file or attachment | file | artifact |
| per-task checkout | workspace, workspace setup | worktree setup |
| git worktree | worktree | workspace |
| top-level pane | tab | workspace |
| machine that runs sessions | host; this device; remote host | computer, machine, worker, daemon host, locally |
| process on a host | daemon (only when starting, stopping, installing) | host |
| the AI in prose | the agent; coding agent (category); subagent | Claude, bot, model, sub-agent, assistant |
| the AI as an identity label (speaker, badge, picker) | the product name: Claude Code, Codex, Fold | claude code, codelayer |
| tenant | organization | org, team, workspace |
| people in it | member; teammates when inviting | user |
| roles | admin, member; owner (of a task/artifact) | administrator, org admin |
| tool-call decision | approve / deny; allow (standing rule) | accept, reject |
| hide reversibly | archive / unarchive | un-archive, remove |
| to trash | delete | archive, dismiss |
| close a nudge | dismiss | delete, hide |
| thread lifecycle | resolve / reopen | mark as resolved, close |
| comments to agent | send to agent; send and resolve | copy for agent (= clipboard) |
| permission modes | bypass permissions, auto-accept edits, manual | YOLO, Auto-Accept, default |
| priority tier | fast mode | Fast Mode, priority-tier |
| reasoning budget | effort | reasoning effort |
| GitHub PR | pull request (prose), PR (labels) | merge request |
| metrics | Team metrics, Advanced metrics, cost per commit, cost per 1,000 lines changed | kLOC |
| filesystem location | directory; path (the string) | folder |

Open product decisions, do not add a third name: the `codelayer` agent option is labelled Codex, shows as CodeLayer in badges, and becomes Fold under a flag; workflows have two label sets (RPI / PRD / TDD / Freeform / Exploratory and Small / Medium / Large / Exploratory).

## Rewrites

| before | after |
|---|---|
| `Failed to approve` | `Could not approve the tool call. The agent is still waiting.` |
| `We couldn't fetch your organizations. Please check your connection and try again.` | `Could not load organizations. Check your connection and retry.` |
| `Something went wrong on our end. Please try again later.` | `Could not reach HumanLayer. Try again in a moment.` |
| `An unexpected error occurred. The error has been reported and we'll investigate the issue.` | `This page could not be rendered. The error has been reported.` + `Try again` |
| `User role updated successfully` / `Draft saved!` | `Role updated` / `Draft saved` |
| `APPROVE & DON'T ASK AGAIN` | `Approve and don't ask again` |
| `Use with extreme caution!` | `The agent will edit files, run commands, and call tools without asking. Turn it off any time with` `⌥+Y` |
| `ENTER to start typing...` | `Enter` `to start typing` |
| `No hosts available. Please start a daemon first.` | `No hosts online. Start a daemon to launch sessions.` |
| `Organization created, but 2 invite(s) failed. Manage invitations at /admin/invitations` | `Organization created, but 2 invitations were not sent.` + `Manage invitations` |
| `Agent delivery is added in Phase 5` | remove the control until it ships |
