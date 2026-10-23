# Release Notes

This page lists changes in each HumanLayer release. Download the latest build from [cloud.humanlayer.com/install](https://cloud.humanlayer.com/install).

## 0.183.0 — October 14, 2026

Teams that run everything on remote hosts can now turn off the desktop app's local daemon, and the daemon starts much faster on large organizations. The minimalist UI moves from alpha to beta: it is on by default for new devices, and it gains multiplayer prompting, HTML artifacts, and a resizable file tree.

**Highlights**

- **Turn off the local daemon** - Desktop users who run all sessions on remote hosts can switch off the local daemon under Settings > Hosts > Advanced. The Daemons section is now called Hosts in both interfaces.
- **Faster daemon startup** - The daemon now loads only this host's tasks before it starts, instead of every task in your organization. On a large org that cut startup from about 4 seconds to half a second.
- **Minimalist UI (Beta)** - New devices now start in the minimalist UI, with a banner that explains how to switch back with Cmd+K. Existing users keep their current interface and see a banner inviting them to try it.

**Other Changes**

- **Signed-in hosts skip setup** - Picking a coding agent that is already signed in on a host no longer opens the setup screen.
- **Turn off daemon self-update per host** - Teams that pin the CLI version in a sandbox image can launch the daemon with `--no-self-update` or set `HUMANLAYER_DISABLE_SELF_UPDATE=1`, so the in-app Update button cannot knock it offline.
- **Tidier slash command menu** - Command names and descriptions line up in columns, and the popup can grow wider so long descriptions are not cut short.
- **Shared artifact pages no longer crash** - Shared artifact links that embed file references now render for people without a signed-in session.
- **Session labels for project tasks** - The first session of a task created from a project gets its research, design, or implementation label again, as directory tasks already did.
- **Orchestrate with auto-advance** - `/hl:orchestrate` now proposes auto-advance defaults for each workflow and shows a workflow chart when it asks which one to use.
- **Teleport keeps hosts current** - `/hl:teleport` updates the HumanLayer CLI, Claude Code, and `gh` on the new host and signs Codex in through HumanLayer.

### Minimalist UI (Beta) Updates

- **Multiplayer prompting** - Turn on multiplayer prompting from the composer's + menu, see who sent each message, and type in the same shared prompt as your teammates.
- **HTML artifacts in the side panel** - Fixed a bug where HTML artifacts would not render in the side panel.
- **Resizable changed-files tree** - Long file names cut cleanly with an ellipsis, and you can drag the tree's edge to resize it.
- **Changed-files tree fix** - A session whose changes replace a file with a folder of the same name opens again instead of crashing.
- **Pick a workflow by task size** - The new-task box suggests a workflow based on how big the task is, and task details let you change it later.


## 0.182.0 — October 9, 2026

Daemon updates now restart more reliably, and Claude Code usage warnings wait until you have used 80% of a limit. New skills help you orchestrate work across tasks and move a task to another machine, while `/rpi:describe-pr` now follows up on PR checks. The Minimalist UI alpha also gets better task navigation, a board, resizable panes, a terminal, and improved diff review.

**Highlights**

- **More reliable daemon updates** - Terminal daemons restart after updating; stalled updates show a failure and retry, with a warning when an older daemon may need a manual restart.
- **Fewer early usage warnings** - Claude Code usage warnings now start at 80% used, rather than warning just because you are using your allowance quickly.
- **Minimalist UI improvements (Alpha)** - Navigate a task's sessions, artifacts, changes, and pull requests; use a Mine/Everyone board and resize panes to fit your work. Enable it in Settings > Experiments.

**Other Changes**

- **Orchestrate work across tasks** - Use `/hl:orchestrate` to break down work, launch tasks in separate worktrees, start sessions, check task status and PRs, and upload, copy, or move artifacts between tasks.
- **Move a task to another machine** - The new `/hl:teleport` skill guides an agent through saving your work, setting up a remote host, and starting a new session there on the same task.
- **PR follow-up** - `/rpi:describe-pr` now watches checks, fixes failures caused by the PR, and asks for approval before resolving merge conflicts.
- **Check for updates** - Find the new Check for updates command in the command palette in either interface.
- **Remote setup guides** - New docs cover LLM gateways, proxies, network access, and disposable hosts, plus a corrected Codex sign-in command.
- **Session status labels** - Restored the standard session table's lowercase labels, including `idle` and `usage limit`.

### Minimalist UI (Alpha) Updates

- **Better diff review** - Long lines wrap, whole files render without the old line cap, and a folder tree shows changed files, comment counts, and viewed marks.
- **Task terminal and tools** - Open a terminal with Cmd+J, open the task in your editor, or copy its directory; switching interfaces keeps the same shell running.
- **Workflow controls** - One auto-advance switch follows the task's workflow, and next-step cards can fold away when you do not need them.
- **Task navigation polish** - Rename from the task title, see newest sessions first, distinguish shared projects, and hide teammates' projects that contain none of your tasks.
- **Small fixes** - Copy a pull request link directly, and hide edit summaries when both line counts are zero.
- **Task context** - Shows task details, teammates, pull request status, generated session names, and bundled skill suggestions.
- **Message controls** - Added batch queue delivery, queued-message copy, file drops, and an always-visible context meter.
- **Comments and previews** - Preserves comment drafts across reloads and interface switches, shows author avatars, and renders embedded task artifacts and skill calls.
- **Menus, archives, and updates** - Added session and artifact right-click menus, in-place archived sessions, and update notices and dialogs.
- **Launch and keyboard fixes** - Keeps your chosen directory when switching hosts, puts this computer first in each host group, and fixes new-tab shortcuts.

## 0.181.0 — October 5, 2026

The diff viewer now shows whole files and reopens to only what changed since your last review. A notification bell replaces session toasts, and pi users can now follow and steer their pi sessions from HumanLayer. A pared-down minimalist interface is also available as an Alpha experiment.

**Highlights**

- **Better diff review** — Expand any file in full, and reopen a changed file to see only what changed since your last review. Files that became ignored drop out.
- **Notification bell** — One bell lists sessions waiting on you until you deal with them, instead of toasts that cover your work and vanish on reload.
- **pi sessions in HumanLayer** — With the pi-humanlayer extension, read a pi session's transcript, task files, and diff in HumanLayer, reply or stop it from the web app, and have the agent answer artifact and diff comments.
- **Minimalist interface (Alpha)** — Try a pared-down layout on real work from Settings › Experiments, and switch back any time.

**Other Changes**

- **Clearer coding agent sign-in settings** — Sign-in settings now live under a new Coding agents group, list only your own hosts, and show hosts signed in from the terminal as signed in.
- **Safer daemon start, stop, and update** — The desktop app no longer freezes while the daemon starts, each host shows its real state, and the app warns you before an update stops running sessions.
- **Composer remembers your host** — The composer picks your last-used host, even while it's starting, and says what that host's state means for the task.
- **Clean up old hosts** — Hosts from automation runs expire on their own, and you can remove your long-offline hosts from settings without losing session history.
- **Better artifact comment filters** — Open, Resolved, and All tabs replace the old filter, remember your choice per artifact, and keep outdated comments visible with their original text.
- **Images and links to artifacts in messages** — Conversation messages now show task artifact images and let you open mentioned artifacts.
- **Repo skills show up right away** — The composer's slash menu lists a repo's skills before any session has run there.
- **Nested subagents in the stream** — When a Claude Code subagent starts another subagent, its prompt, tool calls, thinking, and text show as their own group.
- **Jira and GitHub tickets on task launch** — Attached Jira tickets and GitHub issues now import into the task, as Linear tickets already did.
- **Save repository setup with Cmd/Ctrl+Enter** — Matches every other dialog in the app.
- **Fixes** — New macOS users no longer get stuck in a sign-in loop. Long sessions keep streaming live instead of going quiet. Queue and Interrupt work again in shared sessions while the agent runs. Ready sessions show "Idle" again. HTML, image, and PDF previews highlight the Rendered tab. Pressing `f` no longer opens and then closes artifact fullscreen.

## 0.180.0 — September 30, 2026

GPT-6.1 Sol is now the default Codex model, and Claude Sonnet 5.5 joins the model picker. Public review links show their documents and files again, and usage-limit and context window notices now stay dismissed across sessions.

**Highlights**

- **GPT-6.1 Sol and Claude Sonnet 5.5** — GPT-6.1 Sol is now the default Codex model, and Claude Sonnet 5.5 is available for Claude Code and CodeLayer. Saved GPT-6 Astra defaults move to GPT-6.1 Sol.
- **Public review links show their content** — Signed-out visitors now see documents, HTML pages, images, and PDFs on shared artifact links.
- **Dismiss notices once** — Dismissing the usage-limit notice hides it in every session until the limit resets. Dismissing the context window warning hides it in every session for 7 days, and a new switch in Settings › General turns it off for good.

**Other Changes**

- **Copy session link** — A new button in the session header copies the session link (also Cmd/Ctrl+Shift+C).
- **New PRs after a merge** — The GitHub tab offers a draft PR on branches whose PR already merged, and lists the earlier PRs below the current one.
- **Fixes** — Delivered messages no longer linger in the queue as "Queued." A saved Codex Fast Mode choice no longer causes failed launches on models that can't use it. Parked sessions now show the "Usage limit reset" notice.

## 0.179.0 — September 29, 2026

You can now hand a session off between Claude Code and Codex, and share artifacts through public review links where guests can read and comment. Sessions that hit a Claude usage limit now say so and resume on their own after the reset, and remote daemons tell you when they're out of date.

**Highlights**

- **Hand off to the other agent** — Move a session from Claude Code to Codex, or back. The new session continues on the same task and worktree with the full transcript.
- **Public review links for artifacts** — Share an artifact with a view or comment link, so outside reviewers can read and leave feedback without task access. Existing share links still work.
- **Usage limit alerts** — See Claude usage limits per host. Sessions that hit a limit show why they paused and resume on their own after the reset. Alerts show only on sessions they apply to, so Codex and other-model sessions stay quiet, and you can dismiss them.
- **Keep remote daemons current** — The app flags daemons that fall behind and can push the update to them. The desktop daemon now recovers after your laptop sleeps, and Launch daemon replaces a stuck one.

**Other Changes**

- **Compacted history folds away** — After `/compact`, earlier messages fold behind one header and the summary the agent kept is one click away.
- **In-app sign-in for Claude and Codex (opt-in)** — Sign in to Claude Code or Codex on a daemon host from the app instead of a terminal. Turn it on in Settings › Experiments. Older daemons now say they need an update instead of spinning on "Starting."
- **Host load (opt-in)** — See CPU, memory, load, and disk for each host where you pick one. Turn it on in Settings › Experiments › Host load.
- **Clearer daemon session counts** — Settings › Daemons shows the right number of running sessions and links to each one.
- **Better multiplayer prompts** — In shared sessions the agent now knows who wrote each queued message.
- **Better usage metrics** — Cost now goes to the person who ran the session, not the task owner.
- **More PRs in the GitHub tab** — PRs from branches the session never checked out directly now link to the right session.
- **Better project workspace setup** — When you add a session to a project task on a new machine, the launcher asks where each repository lives before launch. The session view now shows the Workspace tab, and sessions in older tasks open in the right folder.
- **Public link setting applies everywhere** — Turning off public links for an organization now blocks viewing and guest comments on every shared artifact.
- **Smoother Claude sign-in on remote hosts** — Signing in no longer opens an extra tab that ends on an unreachable localhost page.
- **Status bar docks to the prompt box** — The running status bar now sits flush on the prompt box.
- **Fixes** — Resuming a lost Codex session no longer hangs. The artifact viewer no longer crashes when an open artifact gets shorter. The Diff tab no longer crashes on duplicate file paths. Messages that end in an open `[` show the text instead of `[blocked]`. The session page no longer crashes on slash command updates. Project creation no longer appears in the task launcher when Projects V2 is off.

## 0.178.0 — September 24, 2026

This release adds GPT-6 Sol, GPT-6 Luna, and Claude Opus 5.5 to the model picker, fixes comment rail stability in the artifact viewer, and makes task diffs more resilient to large or failed patch uploads.

**Highlights**

- **GPT-6 Sol, Luna, and Opus 5.5** — Pick GPT-6 Sol, GPT-6 Luna, or Claude Opus 5.5 from the model selector across all agent backends.
- **Stable comment rail** — The artifact viewer comment rail no longer resets when the document updates — filters, open replies, and scroll position stay put.
- **Better diff reliability** — A failed or oversized patch upload no longer silently kills all later diffs for a task; large patches are skipped with a message and the stream recovers.

**Other Changes**

- **Clearer comment icons** — Comment buttons now use comment icons instead of the paper-plane "send" icon, so it's obvious which buttons record a comment vs. send to the agent.
- **Cleaner workspace directory names** — V2 workspace directories use familiar repository names (e.g. `humanlayer`) instead of flattened full paths.

## 0.177.0 — September 22, 2026

Navigation and artifact viewing are faster across the board, with large artifacts opening up to 75x quicker. Task diffs now show clean repository names instead of encoded workspace paths.

**Highlights**

- **Faster navigation and artifact viewing** — Message rendering is ~35% faster, and fullscreen artifact transitions dropped from seconds to milliseconds.
- **Cleaner file paths in task diffs** — Repository paths now display as `humanlayer/src/index.ts` instead of encoded workspace directory names.

**Other Changes**

- **Better GitHub PR panel connection guidance** — Clearer instructions for installing the GitHub App at the organization level and reinstalling when permissions change.
- **Draft PR creation uses describe-pr** — The GitHub tab now delegates draft pull request creation to the shared describe-pr workflow.

## 0.176.0 — September 18, 2026

Sessions now link to pull requests through the commit ledger, the GitHub tab surfaces missing App installations and stale daemons, and Bedrock model compatibility improves.

**Highlights**

- **Pull request tracking** — Sessions link to pull requests through the commit ledger with attribution tiers. Org admins can turn tracking on from settings.
- **Better GitHub integration** — The GitHub tab shows which repositories lack the App, names daemons too old to report pull requests, and gives clearer permission warnings with actionable next steps.
- **Improved Bedrock and custom model support** — Bedrock GPT-5.6 Sol compatibility, custom Codex endpoints with bearer or API-key auth, and configurable reasoning summaries.

**Other Changes**

- **Fixed model and thinking-level selection** — Selections apply reliably during the full pointer interaction.
- **Fixed multi-repo worktrees from parent directories** — Directory-backed tasks honor configured multi-repository parent folders and show accurate project-workspace diffs.
- **Fixed launching saved drafts in Projects V2** — Saved drafts launch with proper workspace and session creation.
- **Fixed session launch timing for promoted drafts** — Sessions wait for draft promotion to sync before launching.
- **Automatic session naming for project-backed sessions** — Sessions get auto-generated titles instead of staying "Untitled Session."
- **Better post-logout redirect** — Users return to the app origin instead of the default sign-out page.
- **Clearer daemon launch errors** — Organization-required errors show the correct login command for the active environment.
- **CLI npm tags match release channels** — `@latest`, `@beta`, and `@dev` dist-tags now correspond to production, beta, and dev builds.
- **Improved tool-call repair** — Dangling tool calls from interrupted sessions are repaired more reliably.
- **RPI research skills use specialist agents** — Research delegation stays within the listed specialist roster, avoiding expensive parent model inheritance.

## 0.175.0 — September 12, 2026

This release makes multiplayer prompting fully collaborative: teammates can write in the same response draft with live cursors, presence, and safer draft recovery. It also adds guided plan collaboration, native user administration, faster draft PR creation, and a preview of project-first navigation.

**Highlights**

- **Live multiplayer response drafts** — Write prompts together with shared text, named cursors, presence, read-only viewing, and draft recovery.
- **Plan collaboration milestone** — Onboarding now guides you to collaborate with teammates on plan and design artifacts.
- **Draft PR creation** — Ask the session agent to open a draft pull request from the GitHub tab or diff view.
- **Advanced Metrics for all paid plans** — View usage, cost, and productivity metrics, with optional access for every organization member.

**Other Changes**

- **Image paste in new tasks** — Paste images straight into the new task composer as attachments.
- **Keyboard navigation for changed files** — Move through the PR changes tree with J/K, N/P, G shortcuts, and Enter.
- **Clearer GitHub connection repair** — Get a direct refresh prompt when missing GitHub permissions block pull request status.
- **Reliable project creation** — Create new projects with either pointer or keyboard controls.
- **Stable artifact menus** — Artifact action menus now stay open when moving the pointer into them.
- **Faster daemon shutdown** — Ctrl+C now exits cleanly, with a second press available to force an immediate stop.
- **Remote daemon setup video** — Watch the setup walkthrough inside the remote daemon guide.
- **Project-first navigation preview** — Projects V2 adds a project-first sidebar, repository setup controls, browser task launching, and enforced sharing settings.

## 0.174.0 — September 10, 2026

This release fixes an error dialog on quit and improves stream connection speed.

**Highlights**

- **Fixed quit error dialog** — Resolved an error that could appear when closing the application.
- **Faster stream initialization** — Reduced stream connection timeout for quicker session startup.

## 0.173.0 — September 9, 2026

This release fixes model switching between messages in Fold conversations, adds a visible "Open on GitHub" control to the PR panel, and improves session stability.

**Highlights**

- **Fold model and thinking changes take effect between messages** — Switching models or thinking levels no longer requires reopening the conversation, and each agent's usage is now priced using its own model.

**Other Changes**

- **"Open on GitHub" button** — The GitHub tab now shows an explicit control to open the pull request on GitHub, replacing the previously invisible link.
- **Freeform PR auto-advance** — The V3 launcher shows the auto-advance toggle for Freeform mode with its keyboard shortcut.
- **Session streaming resilience** — Streaming setup is now bounded to 10 seconds; on failure or timeout, streaming disables gracefully without blocking the session.
- **Reduced localStorage growth** — Upgraded to Electric's upstream fix that stops unnecessary localStorage writes in Tauri builds.

## 0.172.0 — September 8, 2026

The GitHub tab now handles the full pull request lifecycle — merge, close, draft, and review threads — so you can act on feedback without leaving HumanLayer.

**Highlights**

- **Pull request actions in the GitHub tab** — Merge, close, convert to draft, update branch, and enable auto-merge directly from the tab. Review threads and changes-requested bodies now appear alongside checks. To enable, connect GitHub at [cloud.humanlayer.com/settings](https://cloud.humanlayer.com/settings) and enable GitHub PR Tab in Settings > Experiments.
- **Send failing checks to agent** — Hand failing CI checks from the GitHub tab to the session's agent with one click for investigation.

**Other Changes**

- **Tab navigation with Ctrl+Tab** — Navigate workspace tabs with Ctrl+Tab and Ctrl+Shift+Tab on desktop.
- **Better task name conflict messages** — Conflicts now explain which slug is taken and whether the holder is archived.
- **Skill autocomplete restored in task launcher** — Typing `/` in the task launcher shows available skills again.
- **Diff loading skeletons** — Diff viewer shows themed skeleton rows while patches load.
- **Fix update notifications on startup** — Update notifications stay actionable when the app is starting up.
- **Better artifact comments** — Approve and Delete actions hide when typing to prevent accidental verdict submission.
- **Fullscreen artifact toolbar fix** — Toolbar tabs align correctly in fullscreen mode.
- **Hide empty artifact outlines** — Artifacts without headings no longer show an empty outline panel.
- **Fix session refresh after org creation** — Creating a new organization no longer redirects to sign-in.
- **Fix token streaming** — Token streaming resumes correctly when stream connections are replaced.
- **GitHub tab reliability** — The panel shows clear states when data is unavailable instead of hanging.
- **Window dragging from tabs** — Click and hold a workspace tab to drag the window on desktop.
- **Better resize handles** — Wider, more visible drag handles with 240px sidebar minimum width.
- **Fix device setup overflow** — Agent cards with long paths no longer overflow the settings column.
- **WebKit storage fix** — Fixed an issue where Tauri's localStorage WAL could grow to multiple gigabytes.
- **Cost tracking for custom OpenAI endpoints** — Sessions on Azure AI Foundry or custom Responses endpoints now record cost.
- **Hide web task onboarding** — Desktop-only task onboarding no longer appears in the web UI.
- **Filter stale hosts** — The task launcher no longer shows disconnected remote hosts.
- **Fix terminal resize grip** — Terminal drag handle stays horizontal.

## 0.171.0 — September 5, 2026

This release adds live GitHub PR status in-app, ships GPT-6 Astra as the default Codex model, and makes the new task launcher and improved onboarding the default for all users.

**Highlights**

- **GitHub PR Status in-app** — Shows CI checks and PR status live in HumanLayer. To enable, connect GitHub at [cloud.humanlayer.com/settings](https://cloud.humanlayer.com/settings) and enable GitHub PR Tab in the app's Settings > Experiments
- **GPT-6 Astra** — Ships as the default Codex model with reasoning, fast-mode, and usage tracking
- **Advanced Metrics by plan** — Advanced Metrics is now available to all Pro and Enterprise orgs, with commit tracking left as opt-in
- **Launcher V3** — The new task composer is now the default for all users
- **Improved onboarding** — Onboarding guides run for all users until milestones complete, with no dismiss or skip path

**Other Changes**

- **Experiment toggles sync across devices** — Experiment settings persist in the database so web and desktop agree
- **Responsive artifact action tray** — The artifact action row overflows gracefully at narrow sidebar widths
- **Better artifact keyboard navigation** — J/K navigation focuses the artifact row so Enter opens it; Shift+A opens the switcher in all states
- **Artifact outlines default closed when narrow** — The outline starts collapsed below 500px; explicit preference overrides
- **Better artifact range selection commenting** — Text selection shows a toolbar; the comment composer opens on click, and Cmd+C still copies
- **Slack channel pagination fix** — Newly created or invited Slack channels now appear after refresh
- **Inactive Claude session cleanup** — Claude subprocesses are stopped on archive/delete and reaped after 10 minutes idle
- **Null byte crash fix** — A deep value-level sanitizer replaces the broken JSON-level null-byte stripping that caused daemon crashes
- **Window dragging from workspace tabs** — The top tab bar is a drag region again
- **Task title generation debounce** — Auto-generated titles wait 3 seconds after the last keystroke, reducing flicker
- **Draft saving progress** — The launcher shows "Saving draft..." while the save completes
- **Deep link "Session Not Found" fix** — Cold deep links hold a boot animation until auth resolves instead of flashing an error
- **Workspace setup skips non-Git directories** — Worktree options are disabled outside Git repos; tasks launch directly
- **Compact workspace tab button** — The new-workspace button is a consistent 20x20px icon, vertically centered in the tab row
- **Shift+A scoped to artifact sidebar** — The Shift+A shortcut no longer fires outside the artifact sidebar
- **Enter confirms directories in V3 launcher** — Enter or click now selects a typed directory path and closes the picker
- **Launcher directory check fix** — The V3 launcher no longer gets stuck on "Checking selected directory..."
- **Startup navigation loop fix** — Saved-tab restoration no longer interrupts authentication, fixing a loop that could saturate the renderer

## 0.169.0 — September 1, 2026

This release adds advanced token usage and spend tracking for Pro users, Grok support for the Fold coding agent, and Claude Fable 5.1 as a model choice. It also lets you sort diff files by the agent's most recent change and ships several stability fixes.

**Highlights**

- **Advanced token usage & spend tracking (Pro)** — A new Advanced Metrics tab ranks every task by token spend or cost, with filtering, scrolling, and six ways to split each bar (by agent, model, stage, person, or mode).
- **Grok agent compatibility** — The Fold coding agent now works with Grok models. Enable it under Settings > Experiments > Use Fold Coding Agent.
- **Sort diff files by latest change** — Reorder diff files so the agent's most recent edits appear first, across the review, sidebar, and Diffs tab.
- **Claude Fable 5.1** — Available as a model choice with the existing Fable effort policy.

**Other Changes**

- **Better Codex session stability** — Provider error events no longer crash the stream.
- **Fixed Bash timeout handling** — Sessions no longer risk running past their time limit.
- **Sidebar shows new sessions** — Newly created sessions appear without needing a reload.
- **Linear artifacts in V3 task launches** — Attached Linear tickets and images are restored.
- **Task links in Advanced Metrics** — Task names now open the task in the app instead of an empty page.
- **Bar segment hover details** — Hover any segment in a task bar to see its name, value, and share.
- **Commit attribution wait state** — Shows a clear message instead of empty charts before commits are attributed.
- **Enter key focuses composer** — Pressing Enter in the right pane focuses the main composer when nothing else handles the key.
- **Design discussions with visual context** — Design discussion creation now includes visual guidance.
- **Collapsed workspace row shows repos** — The V3 workspace setup row shows which repositories are selected while closed.
- **Fixed artifact creator names** — Artifact version creator names display correctly instead of a hardcoded fallback.
- **Improved task row readability** — Value cells in the token-use-by-task card use uniform legible styling.

## 0.168.0 — August 29, 2026

This release adds flexible keybindings, clearer Advanced Metrics, and a smoother path from onboarding through workspace setup.

**Highlights**

- **Custom keybindings** — Choose whether Archive uses `E` or `Cmd/Ctrl+E`, and whether Enter or `Cmd/Ctrl+Enter` sends messages, with a cleaner settings layout and clear confirmation when shortcuts change.
- **Clearer Advanced Metrics** — See which tasks drive token use and cost, and compare workflow spend in ranked lists with daily trends.
- **Smoother task and workspace setup** — Onboarding links open the right workflow, freeform sessions keep their task titles, repository choices stay compact, and recovery controls work across workspace views.

**Other Changes**

- **Smarter workflow labels** — Freeform tasks are classified as research, design, or implementation so they appear in the right work view.
- **Calmer tooltips** — Tooltips wait before appearing while still showing at once when you move between nearby controls.
- **Safer keyboard navigation** — Kanban shortcuts no longer conflict with sidebar input.
- **Clearer comment feedback** — Selected text and nearby context keep their line breaks in conversation comment packets.
- **Reliable settings exit** — Back and Escape return home after a restart when no prior page exists.
- **More reliable artifact loading** — Artifact lists load correctly when live sync falls back to polling.
- **Automation sessions guide** — The docs now cover running HumanLayer sessions in automations, with GitHub Actions as a full example.

## 0.167.0 — August 28, 2026

This release fixes a deadlock that could stall session cleanup when a Claude agent is interrupted.

**Highlights**

- **Claude interruption fix** — Fixed a deadlock that could stall session cleanup when a Claude agent is interrupted

## 0.166.0 — August 27, 2026

This release shows recent drafts in the new task composer, cuts wait time when moving through large sessions, and adds more keyboard controls. It also includes an experimental way to run scoped coding sessions from GitHub Actions.

**Highlights**

- **Recent drafts in the new V3 task composer** — Recent drafts come first, save as you navigate, and retain your workflow and working-directory choices.
- **Faster session navigation** — Large sessions open faster, while sidebar size, visibility, and selected content stay consistent as you move between views.
- **HumanLayer in GitHub Actions** — Experimental feature: run one scoped coding session from a GitHub Actions job and return its final result. Ping founders@humanlayer.dev for access.

**Other Changes**

- **More keyboard control** — Move between adjacent tabs and attach Linear, GitHub, or Jira tickets from the launcher with new shortcuts and clear key hints.
- **Better slash commands** — Open the slash-command menu later in a message without treating file paths as commands.
- **Smarter minimap following** — Stay pinned to new activity near the end of a session, pause when you scroll up, and reveal focused items more reliably.
- **Artifact viewer fix** — Fix the broken fullscreen hotkey in the artifact viewer.
- **A tighter session workspace** — Compact stream headers leave more room for the session, and update controls match the rounded-corner setting.
- **Codex browser fix** — Fix a bug where Codex agents tried to use Codex in-app browser skills and tools in HumanLayer.

## 0.165.0 — August 26, 2026

This release adds diff review scope filtering to focus on unreviewed files, routes deep links and notifications through workspace tabs for better multi-tab navigation, and makes task launches instant. Fold agent sessions are available as an early-access preview.

**Highlights**

- **Diff review scope filtering** — Filter diff review to show only unreviewed files, hiding completed files from the tree, code stack, and navigation.
- **Workspace tab routing** — Back/Forward history, notifications, and deep links now open in the correct workspace tab instead of navigating away or creating duplicates.
- **Faster task launches** — Task drafts launch with instant optimistic navigation; duplicate launches are prevented automatically.

**Other Changes**

- **Session host memory** — New sessions default to your most recent host for that task.
- **Tips tab visibility** — The sidebar Tips tab only appears when the current phase has tips.
- **Theme color fix** — Restored semantic success colors in generated VS Code themes.
- **Artifact viewer escape handling** — Pressing Escape in fullscreen now clears a selected range before closing the view.
- **Fold agent sessions (preview)** — Early-access agent sessions with tool delegation and fork history, behind the Fold experiment.

## 0.164.0 — August 25, 2026

Horizontal tabs, the V3 task launcher (beta), bulk diff review actions, pinned prompts, and Context Shards in early access.

**Highlights**

- **Tabs** — Open multiple tasks and sessions side by side with horizontal tabs. `Cmd+T` opens a new tab, `Cmd+1`-`Cmd+9` switches between them, and each tab remembers its last location.
- **V3 task launcher now in beta** — Check Settings > Experiments to try it.
- **Bulk diff review actions** — Mark changed files as reviewed or unreviewed in bulk, and collapse or expand them. Click the comment icon to view the comment tray.
- **Pinned prompt** — Your latest message stays pinned at the top while the agent works.
- **Context Shards + Compounding Engineering (early access)** — Your organization's engineering knowledge compounds across sessions. Reach out via Slack or founders@humanlayer.dev to opt in.

**Other Changes**

- **Better @ mention path completion** — The @ picker now completes typed absolute paths by listing one directory at a time, including hidden directories and files with spaces in their names.
- **Better diff panel layout** — The task diff panel stays readable when the sidebar is narrow, progressively hiding less important controls.
- **Better artifact comment controls** — Comment cards in artifact review now show consistent jump-to-anchor and resolve controls.
- **Electron build improvements** — The Electron build is now in beta. Reach out to try it.

## 0.163.0 — August 20, 2026

Hotfix release after [v0.162.0](https://docs.humanlayer.com/release-notes#_0-162-0-%E2%80%94-august-20-2026).

This release makes artifact deletion more reliable and fixes fullscreen links from Slack. Deleted artifacts now stay out of active task files, and native links open without route errors.

**Highlights**

- **Reliable artifact deletion** — Deleted artifacts no longer return as active files when agents process task changes.

**Other Changes**

- **Fullscreen Slack links** — Fullscreen task and session links now open correctly in the desktop app.

## 0.162.0 — August 20, 2026

This release turns on collaborative diff review and instant workspace setup by default, and tasks are now shared by default so teammates can create sessions that share task artifacts. The artifact viewer also picked up structured JSON support, alongside reliability fixes to previews, comments, links, and notifications.

**Highlights**

- **Diff review and instant workspace setup, on for everyone** — The collaborative diff-review flow and instant daemon-based workspace setup are now on by default, no longer an opt-in experiment.
- **Tasks are shared by default** — Teammates can create sessions that share task artifacts.

**Other Changes**

- **Richer artifact comments** — Comments in the artifact viewer now render markdown (bold, links, code) instead of plain text, and resolved comments fade out instead of disappearing all at once.
- **JSON artifacts render as structured trees** — JSON and JSONL files in the artifact viewer now display as browsable trees instead of raw text.
- **Artifact viewer fixes** — HTML and image Previews now refresh automatically instead of needing a reload, and fixed version history showing the wrong author.
- **Fewer broken links and hidden content** — Fixed valid links being blocked in rendered messages, and conversation messages now show XML tags instead of hiding them.
- **Clearer feedback on sent messages** — A toast now confirms whether feedback sent to an agent went through immediately or was queued; fixed interrupt messages sometimes showing the wrong sender.
- **Simpler Slack notifications** — Notifications are simpler, link directly to the right artifact, and no longer clutter threads with link previews.
- **Sidebar improvements** — The outline panel remembers whether you left it open or closed, and a new Vim-style scratch pad is available for quick notes.
- **Task fixes** — Fixed task creation failing when a task name was too long.

## 0.161.0 — August 18, 2026

This release refines the planning workflow with visual change trees in outlines, brings the cleaner session-page design to task pages, and makes workspace setup more reliable when work moves between machines.

**Highlights**

- **Visual change trees in planning outlines** — Structure outlines now show a compact change tree for each phase instead of a long file list, and outline views follow along as the plan changes.
- **Cleaner task page** — The task detail page adopts the session-page redesign: a borderless session table and a softly tinted summary in place of boxed cards.
- **More reliable workspace setup across machines** — Workspaces pin to the exact commit from their first successful setup, so moving a task to another machine or resetting rebuilds from the same source instead of drifting to a moved branch.

**Other Changes**

- **Better web search and fetch handling** — Large web search and fetch results are truncated so one lookup can't crowd out the rest of a session.
- **Bounded subagent nesting** — CodeLayer subagents now delegate at most three levels deep, keeping fork chains from spawning runaway nested agents.
- **Grouped retro themes** — The theme selector gathers the low-contrast retro themes under their own "Retro" heading.
- **Multiplayer prompting tooltip** — Hovering the inactive multiplayer prompting control now shows what it does.

## 0.160.0 — August 17, 2026

0.160.0 makes sessions collaborative and easier to hand off. You can share a live session with a teammate for a set time, transfer a task to another owner, and pick up sessions that were lost when a daemon dropped. Diff review and file drag-and-drop also got a round of improvements.

**Highlights**

- **Concise PR descriptions** — Pull requests made from HumanLayer now have concise descriptions aligned with the [/show-me](https://www.skills.sh/humanlayer/skills/show-me) skill.
- **Multiplayer Prompting** — Share a running session with teammates for a set time so they can prompt, interrupt, and resolve approvals; every message now shows who sent it. Admins enable it in Optional Features.
- **Transfer task ownership** — Hand a task to another member; the owner and collaborators now show clearly on desktop and mobile.
- **Recover lost sessions** — A session orphaned by a daemon interruption is now marked lost and can be continued instead of failing.
- **Better diff review** — The fullscreen review adds a comments panel to see, filter, and jump between every thread, plus GitHub-themed diffs and more reliable resolve.

**Other Changes**

- **Drag and drop files anywhere** — Drop a file anywhere in the window to attach it; a stray drop no longer takes over the app, and drops now work on the Linux desktop app.
- **Faster task diffs** — Diffs regenerate only for changed files and recover cleanly if the stream drops.
- **Clearer code blocks** — Code in conversations renders on a darker surface with higher-contrast syntax colors.
- **Cleaner Linux window** — The Linux desktop app shows a single title bar instead of a duplicate menu bar.
- **Keyboard hints stay visible** — Shortcut labels keep their accent color when you hover a button.
- **See where sessions run** — Sessions running on a remote host now show a cloud icon in the sidebar.
- **Workspaces start from origin/main** — New workspace configs default to `origin/main` instead of your current checkout.

## 0.159.0 — August 14, 2026

0.159.0 is a stability pass on top of 0.158.0. Sessions survive a daemon briefly going offline instead of being marked failed, comment notifications stop ringing on repeat, and Codex subagents handle injected skill messages more precisely.

**Highlights**

- **Sessions survive daemon hiccups** — When a daemon goes offline, only truly active sessions are affected; inactive ones are no longer marked failed, and interrupted sessions resolve cleanly.
- **Quieter comment notifications** — A burst of comments syncing at once now plays a single notification sound instead of ringing for several seconds.

**Other Changes**

- **Tune codex subagent behavior** — Injected skill messages are no longer mistaken for your own turns.

## 0.158.0 — August 13, 2026

0.158.0 cleans up a batch of issues on top of 0.157.0. Large workspace state syncs to the cloud again, MCP tool results report success and failure accurately, and sidebar keyboard navigation, the command palette, and a couple of controls behave the way you'd expect.

**Highlights**

- **Large workspace state syncs again** — Workspaces with a lot of state no longer get stuck retrying; they save to the cloud.
- **Accurate MCP tool results** — A tool result no longer looks failed just because its output mentions the word "error."

**Other Changes**

- **Sidebar keyboard navigation** — `s` and `Shift+S` cycle through only the tabs that are actually visible, in their displayed order.
- **Command palette** — The session you already have open no longer takes a slot among recent sessions.
- **Hostname control** — Only the host icon and name respond to hover and clicks, not the empty space beside them.
- **Running subagents** — Active subagents show the shared animated spinner, and it appears only while an agent is actually running — no more stale indicators on finished or collapsed blocks.

## 0.157.0 — August 12, 2026

This release makes authentication more reliable across HumanLayer processes, improves syntax highlighting and command palette styling, and fixes Codex subagent dispatch failures. It also sharpens visual file trees generated by the Show Me skill.

**Highlights**

- **Reliable shared authentication** — CLI commands and daemon processes can safely share refreshed credentials without unexpected sign-in prompts.
- **Fixed Codex subagents** — Codex subagent calls no longer fail when models send blank optional fields.
- **Clearer syntax highlighting** — Custom palettes now use readable, well-tested highlighting themes.
- **Improved command palette focus** — Selected rows use a softer accent treatment consistent with session and task tables.

**Other Changes**

- **Better Show Me file trees** — File layouts now use clear tree glyphs for branches and nested paths.

## 0.156.0 — August 12, 2026

This release sharpens the reading experience across session and task views, with a full-height sidebar and collapsible "Worked for Ns" blocks that fold long agent runs. It also fixes artifact paths on tasks shared across machines and stops repeat repository-setup prompts — and there's a new v3 task composer to try under Settings.

**Highlights**

- **Cleaner, faster session & task views** — the right sidebar now runs the full window height with lighter styling, and long tool-call runs collapse into expandable "Worked for Ns" blocks so the conversation stays readable; j/k navigation is smoother too.
- **New v3 task composer (experimental)** — try the redesigned task form under Settings → Experiments → New Task Form.

**Other Changes**

- **Correct artifact paths across machines** — on tasks shared between machines, copy-path and editor actions resolve to your own machine, and file actions hide when there's no local copy.
- **Fewer repeat setup prompts** — starting a new session on a host you've already set up no longer re-asks where your repositories live.

## 0.155.0 — August 12, 2026

This release speeds up everyday work and makes agent delegation far more capable. Session navigation is snappier, the ⌘K launcher now surfaces your recent sessions, and unfinished composer work survives reloads and crashes. Codex gains automatic context compaction and a `/compact` command, subagents can be resumed after they finish or error, and Codex subagents can now fork from the caller's context.

**Highlights**

- **Faster session navigation** — Opening and switching sessions is much snappier; we removed the main-thread stalls that made j/k navigation and session entry feel sluggish.
- **Show recent sessions in the ⌘K launcher** — Open the command launcher and your three most recently active sessions are right there to resume, each with live status.
- **Drafts and crash recovery** — Unfinished work in the composer survives reloads, crashes, and auth redirects, and you can reopen recent drafts to pick up where you left off. New sessions also get auto-generated titles.
- **Codex autocompaction and `/compact` support** — Codex sessions now compact their own context automatically as it fills up, and you can run `/compact` yourself to trim a long conversation on demand.
- **Subagent resumability in Claude and Codex** — Subagents can be continued after they finish, error, or are interrupted, so long delegations survive across sessions instead of starting over.
- **Fork-mode subagents for Codex** — Codex subagents now fork from the caller's context instead of starting cold — a dramatic improvement in how much delegated work starts out knowing.

**Other Changes**

- **Better repo selection for large workspaces** — The worktree setup list is now a fixed-height, scrollable picker with fuzzy search, so workspaces with hundreds of repos are easy to work through.
- **More reliable workspace setup** — Starting a session on a workspace another machine already built no longer fails; HumanLayer adopts the existing worktree and branch.
- **Clearer cloud tabs** — Task and artifact pages show the task or file name in the browser tab, so multiple open tabs are easy to tell apart.

## 0.154.0 — August 10, 2026

Artifact Viewer V2 is now the default for markdown, with version comparison, deep links to comment threads, and reading position that survives live edits. This release also brings faster ways to start sessions, theme polish, a batch of reliability fixes, and an experimental diff review.

**Highlights**

- **Artifact Viewer V2 is now the default** — Markdown artifacts open in V2 across cloud and desktop, with side-by-side version comparison, deep links to comment threads, and preserved scroll, focus, and folds across live edits.
- **Start sessions from anywhere** — Kick off a new session straight from a task's Kanban card, table row, or sidebar menu.
- **Diff review (alpha)** — Review your agent's changes with keyboard-driven diff navigation and inline comments. Enable it in Settings → Experiments; requires using worktrees for tasks.

**Other Changes**

- **Theme polish** — Rose Pine is the new default, Vercel Dark gets higher-contrast inline code and correct syntax and badge colors, and the wrong-theme flash at startup is gone.
- **Custom Claude binary** — Point HumanLayer at a specific claude path with `HUMANLAYER_CLAUDE_PATH` in your shell profile; requires opening HumanLayer from the command line.
- **Clearer daemon status** — Settings → Daemons shows every daemon as Online, Stale, or Offline instead of dropping offline ones.
- **Doc updates** — A batch of documentation improvements at [docs.humanlayer.com](https://docs.humanlayer.com).
- **Visual explanations** — New `/rpi:show-me` command generates quick diagrams and sketches.
- **Live tab titles (web)** — On the web app, browser tab titles show the current task, session, or artifact.
- **Minimap filenames** — Read/Write/Edit filenames stay visible with a concise relative path.
- **Smoother updates** — Fixed an auto-update loop that wasted CPU, and settings panes no longer clutter Back-button history.
- **Fewer session hiccups** — Sessions tolerate new Claude content types, and empty thinking messages show a label instead of a blank gap.
- **Mobile artifact comments** — Mobile artifact review now supports V2 comment threads and whole-block comments.
- **Alpha: Scratch pad** — Private, device-local scratch pad tab in task and session sidebars. Enable in Settings → Experiments.

## 0.153.0 — August 7, 2026

Linkable file headers and diff comments in the diff viewer, Codex fixes, and other bug fixes and performance improvements.

**Highlights**

- **Linkable file headers and diff comments** — In the diff viewer, copy a link to a file header or comment that reopens it in place. Enable the Collaborative Diff Viewer in Settings → Experiments to use it.

**Bug Fixes**

- **First session inputs** — Task input files and attachments reach disk before the first agent session starts, so it no longer begins without them.
- **Codex parallel tools and sub-agents** — GPT-5.6 Codex sessions use the correct response format again, restoring parallel tool calls and sub-agent dispatch and fixing response and cache accounting.
- **Codex research model** — Codex research sub-agents now run on Terra X high instead of the session's larger root model.
- **Session token usage** — Complete, correct token counts — total, cached, uncached, and per model — on desktop and mobile.

**Other Changes**

- Performance improvements and additional fixes.

## 0.152.0 — August 4, 2026

This release adds safer app updates, clearer workspace failure alerts, and better session continuity across sign-in and reloads. It also improves docs, navigation, task assignment, and the Artifact Viewer V2 preview.

**Highlights**

- **Safer app updates** — HumanLayer now warns when restarting for update will interrupt active sessions and shows how many sessions are at risk.
- **Artifact review preview** — Artifact Viewer V2 adds read-only Raw mode, direct comment creation from clicks and text selections, retained review drafts, inline review actions, and faster page scrolling.
- **Duplicate uploads** — Repeated file names receive numbered suffixes instead of replacing earlier task artifacts. That means you can paste multiple images without them overwriting each other.

**Other Changes**

- **Daemon-Side Workspace setup alerts** — Task owners now receive a notification when workspace setup fails, with a direct path to inspect and retry the setup.
- **Session continuity** — Unsent session input now survives reloads and reauthentication, and sign-in returns you to the route you had open.
- **Session Task assignment** — Add, change, or remove a session's task through one searchable dialog from the command palette or `Shift+T`.
- **Artifact actions** — Artifact rows now expose their existing actions through a visible ellipsis menu as well as right-click.
- **Clearer conversations** — Messages preserve single line breaks, focused rows use a subtler tint, and `Shift+Enter` keeps the cursor visible in long inputs.
- **Stable native UI** — Fixed WebKit hangs and page shifts tied to activity animations and sending messages.
- **Improved navigation** — Sidebar controls stay aligned across app views, Settings returns to the prior page, and login reliably opens the main app.
- **macOS keyboard behavior** — App shortcuts stay on Command while Control-key text editing (e.g. readline) remains available.
- **Better workflow graphs** — Text remains sharper after panning and zooming on standard and high-density displays.
- **Reworked documentation** — New tutorials, guides, explanations, and reference pages cover first tasks, remote workers, workflows, workspaces, integrations, system prompt additions, skills, and authentication.
- **Workflow refinements** — Generated RPI session titles use clear skill prefixes, design prompts focus on design choices rather than test strategy.
- **New Themes** — Choose from Rapture, Tactical, Neuromancer, Red Alert, Covenant, Wintermute, Dash, and Wednesday, with matching terminal, markdown, and diff colors.

## 0.151.0 — July 31, 2026

This release adds one desktop view for task work. It improves Linear and Jira connections, mobile typing, and short conversation updates.

**Highlights**

- **Unified Tasks workspace** — Switch between saved List and Board layouts, filter by owner or scope, and group lists by workflow stage from one Tasks destination.
- **Better Linear and Jira connections** — Admins can connect or reconnect directly from the desktop task form, with clear success, retry, and failure screens.
- **Clearer sub-agent settings guide** — New docs explain how Claude Code and Codex choose models and effort levels for RPI sub-agents.

**Other Changes**

- **Smoother short conversations** — Fixed blinking and unstable scrolling when a conversation does not fill its pane.
- **Better mobile input behavior** — iOS no longer zooms the page when you focus an input, text area, or select field.

## 0.150.0 — July 29, 2026

This release makes daemon workspaces easier to use across machines. It adds clear Claude failure details and improves worktree-aware RPI handoffs. It also fixes two UI issues.

**Highlights**

- **Portable daemon workspaces** — Tasks created on one machine now use home-relative repo paths, so they can run on another machine without carrying over the original user's home directory.
- **Clear Claude failure messages** — Failed sessions now show the real SDK error, such as an auth failure, exit code, or stderr, instead of `CLAUDESDKERROR`.
- **Smarter worktree handoffs** — Structure-outline and plan sessions already inside a worktree now route straight to implementation instead of suggesting another worktree setup.

**Other Changes**

- **Plain thinking status** — A new Settings → Experiments option replaces rotating thinking verbs with a steady "Thinking."
- **Clickable session rows** — Session-list tooltips no longer block clicks on nearby rows and close when the pointer leaves.

## 0.149.0 — July 27, 2026

JSON and JSONL artifacts now use a structured viewer. Task creation from GitHub, Linear, or Jira tickets is more stable. CodeLayer sessions now load Codex-style skills and installed plugins.

The desktop app is faster during long streaming sessions. Task lists are more stable. This release also improves remote worktree setup and diff comment threads.

**Highlights**

- **JSON and JSONL artifacts** — A collapsible tree with search, syntax colors, and a rendered/raw toggle, across desktop, fullscreen, mobile, and shared links.
- **Task creation from tickets fixed** — Fixed a race condition that could make task creation fail for a GitHub, Linear, or Jira issue. The form now requires a ticket ID when inline content is empty.
- **Codex skills and plugins** — CodeLayer sessions discover skills from `.codex/skills`, `.agents/skills`, and `.claude/skills` plus installed plugins, with predictable precedence, and prefer `AGENTS.md` over `CLAUDE.md`.
- **Worktrees Now on remote hosts (experimental)** — Remote hosts can create worktrees before the task starts, set up by the daemon. Opt in with Daemon-Driven Workspace Setup in Settings → Experiments.
- **Comments on diffs (experimental)** — Leave inline threads on a task's diff, reply, edit, resolve, and send the feedback back to the agent. Enable the Collaborative Diff Viewer in Settings → Experiments.

**Other Changes**

- **Faster streaming and rendering** — Streamed text now commits on a paced tick and markdown re-renders only the newest block, cutting main-thread work during long sessions.
- **Steadier task and session lists** — Rows sort by activity minute, so lists stop shuffling every few seconds while agents run in parallel.
- **Smoother diff review** — Holding `j`/`k` or scrolling large files in the diff viewer no longer stutters, and the DIFFS tab opens quickly.
- **Edit and delete artifact comments** — Artifact Viewer V2 lets you edit your own comments and delete a reply or an entire thread.
- **Skills and workflows docs** — A new guide and reference covering RPI, PRD-Oriented, Oneshot, and Freeform, with a cheat sheet of every command.
- **Better Jira errors** — Jira failures return actionable messages instead of a generic 500.

## 0.148.0 — July 24, 2026

This release adds Claude Opus 5 as a selectable model. It reduces CPU usage and fixes a session-continuation hang.

**Highlights**

- **Claude Opus 5** — Select Opus 5 as a fixed model; the `opus` alias now resolves to Opus 5.
- **Reduced CPU usage** — Lower background CPU usage while the app is idle.
- **Continuation fix** — Follow-up messages sent to a continuing session no longer hang or get dropped.

**Other Changes**

- **Git ignore handling** — Only edits `.gitignore` when Git doesn't already ignore its task-artifacts path.
- **Next-step drafts** — Next-step drafts opened from a task page no longer duplicate the skill text.

## 0.147.0 — July 24, 2026

This release improves usability and performance. It also fixes Claude Code bugs.

**Highlights**

- **Faster Claude session resumption** — Claude Code sessions resume much faster now.
- **Reduced CPU usage** — Optimized live queries & animation profiles to reduce CPU usage.
- **Fixed unresumable Claude sessions** — Some Claude sessions couldn't be resumed.

**Other Changes**

- **`/bro` command** — Restates the agent's last message in plain language.

## 0.146.0 — July 23, 2026

This release improves usability and beta features. See **Settings → Experiments** for the V2 Artifact Viewer, Diff Viewer, and background Workspace Setup.

**Highlights**

- **`Cmd`+`F` search in the V2 Artifact Viewer** — Also supports hotkeys for next/previous navigation.
- **`g` then `t` to jump to the task/kanban view** — Respects your configured default task view (Settings → General).
- **Experimental background workspace setup** — Set up task workspaces in the background on the daemon after task launch, instead of via native app bindings. Useful for remote daemons, with improved UX.

**Other Changes**

- **PDF attachments no longer break sessions** — Sessions that include PDF content are handled cleanly, and the rest of the message still processes.

## 0.144.0 — July 23, 2026

This release simplifies Codex use. It reduces unused space in the desktop header. It also makes Artifact Viewer navigation faster and more reliable.

**Highlights**

- **Codex setup simplified** — Renamed CodeLayer setup to Codex and removed alternative CodeLayer providers. Claude Code is now the only supported harness for Anthropic models.
- **Slimmer desktop header** — The empty drag strip above the app is gone, giving you more vertical space; tabs, breadcrumbs, and fullscreen artifacts now sit cleanly beside the macOS window controls.
- **Better artifact V2 navigation** — `gg` and `Shift`+`G` jump to the top and bottom of long artifacts, the focus highlight now tracks correctly in the desktop app, and `F`/`Escape` reliably exit fullscreen.

**Other Changes**

- **Improved session titles** — Sessions that use an RPI skill now include the skill name as a prefix.
- **Skills in subagents** — Claude Code subagents can now invoke workflow skills.
- **More accurate costs** — Fixed prompt caching for Azure Foundry Codex sessions so sessions reuse cache correctly and report costs accurately.
- **Steadier task diffs** — Experimental task diff views now update incrementally and recover cleanly, so file states stay accurate.


## 0.142.0 — July 21, 2026

Sessions that were never attached to a task now open instead of showing a "Not Found" screen. Codex can use a custom Responses API configuration for Azure AI Foundry. The task diff viewer also runs faster.

**Highlights**

- **Bugfix for standalone sessions** — Patched the "Not Found" UI that appeared when a session didn't have a task.
- **Custom Responses API configurations for Codex** — Point Codex at your own Responses API endpoint, which enables support for Azure AI Foundry.
- **Faster task diff viewer** — Improved diff viewer performance.


## 0.141.0 — July 20, 2026

Claude Code sessions no longer stop early after a tool call. You can now import GitHub issues as tasks. An experimental diff viewer and rebuilt artifact viewer add two review surfaces.

**Highlights**

- **Fixed Claude Code early-stop bug.** Sometimes Claude would stop early after a tool call without producing a result. This has been fixed.
- **Import GitHub issues as tasks.** Connect a GitHub App to start tasks straight from issues.
- **Experimental diff viewer.** Review a task's full diff with keyboard navigation. Turn it on in Settings → Experiments.
- **Experimental V2 artifact viewer.** Reply to, resolve, and send artifact threads back to the agent. Turn it on in Settings → Experiments.

**Other Changes**

- **GitHub issue import** — Issue comments and images come across into the task, and HumanLayer posts a comment back on the issue linking to the task artifacts.
- **Diff review navigation** — The experimental diff viewer supports file and line navigation with `j`/`k`, `n`/`p`, and `h`/`l`, pointer range selection, a fullscreen mode, and open-in-editor.
- **Clearer task sidebar** — Create Task is the primary action, and the sidebar stays put instead of hiding itself.
- **Faster keyboard navigation** — `Shift`+`H` / `Shift`+`L` move between panes, `J`/`K`/`Enter` drive artifact lists, and `Cmd`+`[` / `Cmd`+`]` walk back and forward through history.
- **Better hotkeys guide** — `Shift`+`?` now walks you through the shortcuts and opens once on your first session.
- **Simpler sync settings** — Everyone is on sync v2; the version picker is gone, while Auto/Primary/Fallback and Collection Status stay.
- **Summaries removed** — The Summary tab is gone from tasks and sessions.
- **Download for Mac** — The install page leads with a direct download above the Homebrew command.
- **Clearer Linear errors** — An unreachable ticket now reports a team access problem and links to settings instead of timing out.
- **Linux window fix** — No more blank or corrupted windows on common NVIDIA and virtualized GPU setups.
- **Fewer modal collisions** — The hotkeys guide no longer opens on top of a phase tip.
- **Steadier composer** — Sending a message no longer scrolls the page out from under you.
- **Org domains accept URLs** — Pasting a full `https://` URL into a domain field works.
- **Updated Claude Agent SDK** — Picks up upstream fixes for tool-call failures.
- **Persistent Claude runtime (experimental)** — Opt in to keep one Claude process alive across follow-up prompts.


## 0.140.0 — July 15, 2026

This release makes keyboard shortcuts fully discoverable, speeds up the tasks page, and hardens session stability during Codex work.

**Highlights**

- **Hotkeys Guide** — Open a complete, scope-grouped keyboard shortcut reference anytime with `Shift`+`/`.
- **Faster tasks page** — Improved tasks page load performance.
- **Steadier Codex sessions** — Fixed several stability issues that could cause the daemon to crash while running Codex sessions.
- **Less eager skill use** — Fixed an issue where Codex 5.6 models would invoke skills overeagerly.


## 0.139.0 — July 13, 2026

This release makes collaborative session lists easier to scan without losing ownership context. Compact tables now keep creator identity visible so teammates can quickly see who started each session.

**Highlights**

- **Visible session creators** — Compact collaborative task tables now keep creator names and avatars visible.


## 0.138.0 — July 12, 2026

This release gives organization admins more control over membership and billing, while mobile comment notifications better reflect what still needs attention. Artifact Viewer V2 also receives new early-access review tools.

**Highlights**

- **Member deactivation and reactivation** — Admins can deactivate members without removing them, then reactivate them when needed.
- **Cleaner mobile comment notifications** — Resolved comment threads no longer show unread indicators, while new unresolved replies still surface.
- **Artifact Viewer V2 improvements (early access)** — The experimental viewer now supports document outlines, keyboard navigation, section folding, and whole-block comments.

**Other Changes**

- **More reliable background Git management** — Fixed a daemon bug that could spawn runaway Git processes.
- **Starter-plan downgrade** — Eligible Pro organizations can downgrade to Starter directly from billing settings, with clear capacity guidance when they are over the limit.


## 0.137.0 — July 10, 2026

This release expands model support, makes shared work available on mobile, and improves everyday navigation and task management. It also adds clearer integration setup guidance and several workflow reliability fixes.

**Highlights**

- **GPT-5.6 Codex models** — Use the new Sol, Terra, and Luna models with updated reasoning, Fast Mode, and context-window support.
- **Shared tasks on mobile** — Switch between My Tasks and Shared Tasks to follow teammates' work from mobile.
- **Hidden-file mentions** — `@`-mention files in project directories such as `.claude`, `.github`, `.storybook`, and `.vscode`.
- **Better Kanban administration** — Org admins can rename or archive teammates' tasks, while task owners can now rename directly from the board.

**Other Changes**

- **Integration setup guidance** — New in-product Slack automation guidance and setup guides for Slack, Linear, and Jira.
- **Consistent session forks** — Forked sessions retain the source session's workflow labels.
- **Smoother PRD and TDD workflows** — Interactive question phases no longer receive premature completion reminders.
- **Fable effort controls** — The `fable` model alias now exposes the full Fable 5 effort selector.
- **Reliable docs copying** — Every docs page has a working `copy page` Markdown action beneath its title.

## 0.133.1 — July 8, 2026

A fullscreen viewer for image, HTML, and PDF artifacts, a `FABLE` model alias for bedrock model pinning, and clearer recovery when a Claude Code session can't be resumed. The early-access mobile UI also got a revamped task-creation flow.

**Highlights**

- **Fullscreen artifact viewer** — Open an image, HTML, or PDF artifact directly in the viewer and expand it to a full-screen, content-only view with the header **Expand** button or the `f` hotkey.
- **`FABLE` model alias** — Pick `FABLE` to always get the latest Fable model, resolved through both the Anthropic API and Bedrock (`ANTHROPIC_DEFAULT_FABLE_MODEL`) — matching the existing `OPUS` / `SONNET` / `HAIKU` aliases.
- **Clearer non-resumable session errors** — When a Claude Code session can't be resumed, HumanLayer now shows real recovery guidance ("create a new session; if it keeps failing, update Claude Code") and disables the dead session's input instead of surfacing a cryptic daemon error.
- **Smoother mobile task creation** (early-access preview) — The mobile UI gets a dedicated new-task form, a create affordance on the tasks list, and no more viewport bounce on submit.

**Other Changes**

- **Team metrics accuracy** — Fixed weekly-active-user buckets collapsing to zero on non-UTC hosts; week keys are now UTC-anchored to match the database.
- **Workspace configuration docs** — New [guide](https://docs.humanlayer.com/guide/workspaces.html) covering `.humanlayer/workspace.json` / `workspace.local.json`, single- vs multi-repo setup, and which values to commit versus keep local.

## 0.131.3 — July 7, 2026

Better AWS Bedrock support, smarter Opus 4.8 defaults, and quick copy-URL actions across the app. The early-access preview of our mobile UI also got a refresh and now supports artifact comments and collaboration — try it at [app.humanlayer.com](https://app.humanlayer.com).

**Highlights**

- **AWS Bedrock support** — Run your sessions through Amazon Bedrock instead of the Anthropic API. New [setup guide](https://docs.humanlayer.com/guide/bedrock.html), a `HAIKU` model alias, and a fix so your model selection sticks through interrupt-and-resume.
- **Opus 4.8 → auto permissions** — Selecting Opus 4.8 now switches to Claude Code's safer auto mode automatically, matching the default Claude Code interactive behavior.
- **Copy URL from anywhere** — New "Copy Task URL" / "Copy Session URL" command-palette actions (Cmd+K) on detail pages, table rows, and Kanban cards, plus a right-click item on cards.
- **Mobile Alpha Overhaul** — The early-access preview of our mobile UI. Run a full session from your phone: recover from dropped sync, use the full composer (effort, fast mode, file/photo attach, interrupt & send, drafts), comment on artifacts back-and-forth with the agent, and read a cleaner, tail-following stream. Try it at [app.humanlayer.com](https://app.humanlayer.com).

**Other Changes**

- **Shared artifact links** — Shareable links now render HTML walkthroughs, images, and PDFs, not just markdown.
- **Kanban card titles** — Long unbroken titles no longer stretch columns; they clamp to two lines with the full title on hover.
- **RPI research questions** — The research-questions skill now captures user-provided links, repos, and file paths verbatim in a Key Context Pointers section.
- **Cleaner link previews** — Cloud and app links now unfurl with a real title and description.

## 0.128.0 — July 4, 2026

This release is all about reliability. Sessions and the remote daemon now survive model refusals, duplicate-write hiccups, and single-session errors instead of failing or dropping your host — plus an "Archive Task" command-palette action and a new toggle to group artifacts by document type.

**Highlights**

- **Sessions survive model refusals** — A model refusal that triggered a fallback (e.g. Fable 5 → Opus 4.8) used to kill the session with an "Internal server error" and lose the conversation. Now the fallback is surfaced inline, the session keeps going on the backup model, and the switch persists even if you interrupt and continue.
- **Archive Task from anywhere** — "Archive Task" now appears in the Cmd+K command palette on the task page, a focused task-table row, or a focused kanban card — and kanban cards gain a right-click Archive.
- **Group artifacts by type** — A new "Grouped" toggle in the artifacts sidebar organizes documents into sections by type (Research, Plan, Outline, …), so finding "the plan" is a glance, not a scan.

**Other Changes**

- **Remote daemon resilience** — One session's error (a model/SDK failure or an API blip) no longer crashes the remote daemon and drops your host from the fleet; the bad session is marked failed and every other session keeps running.
- **Settings → Updates no longer crashes** — The Updates page could crash before an update was available; updater metadata is now parsed safely.
- **Iterate button is easier to find** — "Continue in New Session" keeps a "New Session" label at narrow composer widths instead of collapsing to a bare icon.
- **Daemon resource fix** — Fixed a runaway CPU/memory loop that could occur when the daemon lost its parent process.

## 0.126.0 — July 2, 2026

This release adds Sonnet 5 as a first-class model across HumanLayer, makes in-app update notes render as formatted Markdown, and fixes the buttons in HumanLayer Slack messages so clicking them no longer errors.

**Highlights**

- **Sonnet 5 support** — Claude Sonnet 5 is now selectable in the Claude Code and CodeLayer Anthropic model pickers, the generic **Sonnet** option resolves to Sonnet 5, and the context gauge and token warnings use its full 1M-token window.
- **Formatted update notes** — The "Update available" dialog and **Settings → Updates** now render release notes as formatted Markdown, with a scrollable body so the restart buttons stay reachable on longer notes; "View full changelog" opens the docs release-notes page.
- **Slack message buttons fixed** — Clicking **View artifact**, **View task**, or **Reply in HumanLayer** in a HumanLayer Slack message no longer shows "App has not been configured for this feature" — the link just opens.

## 0.124.1 — June 26, 2026

This release adds Slack notifications for tasks — connect your workspace and get artifact and comment activity posted right into your channels — and brings LaTeX math rendering to assistant messages, plus meaningful improvements to the Codex and outline-implementer agents.

**Highlights**

- **Slack notifications for tasks** — Connect Slack under **cloud.humanlayer.com → Settings → Slack** and get task artifact and comment updates posted to your channels. Set up multiple automations with per-channel event and owner filters, messages are grouped into one thread per task, and task owners can mute a task's notifications. Only newly created artifacts and comments trigger a message, so edits stay quiet.
- **Math rendering in markdown** — Assistant messages now render LaTeX math — inline `$...$` and block `$$...$$` — as properly formatted equations.
- **Codex image handling** — Codex now passes images from file reads through as images instead of raw base64, so image-based tasks work correctly.
- **Smarter outline sub-agent** — The outline implementer sub-agent now inherits the parent session's reasoning effort instead of always running at low effort.

**Other Changes**

- **Collaborative task navigation** — Breadcrumbs and the Escape shortcut now return you to your Tasks view (not "Shared Tasks") for collaborative tasks you're actively working on.
- **Layered agent instructions** — The CodeLayer agent now loads instructions from global, repo-root, and working-directory locations, including `AGENTS.local.md` / `CLAUDE.local.md` overrides.

## 0.122.1 — June 24, 2026

This release lets you pick Kanban or the task table as your default task view, makes OAuth-authenticated MCP servers reliably available from the very start of a session, and corrects the context-window gauge for Codex sessions so it reflects the real limit. A couple of workflow and UI papercuts are fixed too.

**Highlights**

- **Choose your default task view** — A new General Settings option lets you set Kanban or the task table as your default. Back-navigation, breadcrumbs, and Escape all respect your choice (Kanban stays the default for existing users).
- **OAuth MCP tools ready from the first turn** — Sessions now wait for plugins to install and MCP servers to connect before the agent starts, so OAuth-authenticated MCP tools are reliably available from the start instead of appearing late or not at all.
- **Accurate Codex context gauge** — Codex sessions now use the real ~258k context window instead of the public ~1M GPT-5 figure, so the token usage badge and near-limit warnings reflect how close you actually are.

**Other Changes**

- **Diagnostic dialog wraps long paths** — The Claude diagnostic dialog now wraps long file paths and text instead of overflowing and pushing the action buttons offscreen.
- **Cleaner outline next-steps** — Finishing or iterating a structure outline no longer suggests the retired `/rpi:create-plan`; it routes to `/rpi:setup-worktree` or `/rpi:implement-outline` based on your worktree timing.

## 0.121.0 — June 23, 2026

This release makes artifact comments more reliable. Comment drafts now remain after accidental closes, navigation, and reloads. It also fixes a crash in some design-phase artifacts with comments.

**Highlights**

- **Comment drafts never get lost** — New comment, reply, and edit drafts now persist across accidental dismissal, navigation, and reload, restoring automatically when you reopen. Drafts clear only on Submit or an explicit Discard. A faint "draft saved" label appears while an editor holds text.
- **Fixed artifact viewer crash** — Opening a design-phase artifact whose comments were anchored to blocks with inline images or block math no longer crashes with "Something went wrong." Those comments now appear as gutter markers, and the viewer degrades gracefully if anything else goes wrong.

**Other Changes**

- **First-class Edit on comments** — Editing a comment is now a dedicated Pencil button next to the resolve checkmark, with a clickable "edit in progress" badge when an unsaved edit survives a reload.

## 0.120.7 — June 22, 2026

This release improves planning workflows. PRD and TDD skills now reach a decision before they edit the document. `describe-pr` skips large walkthroughs for small pull requests. The release also adds clean documentation URLs and a UI fix.

**Highlights**

- **Smarter PRD/TDD interviews** — Planning skills now run each decision as an interview loop: clarifying questions and pushback continue the conversation instead of rewriting the doc on every message, so your spec stays stable while a decision is still being worked out.
- **Lighter PR descriptions on small diffs** — `describe-pr` skips the interactive HTML walkthrough for small PRs (under 300 changed lines or fewer than 5 files), so quick changes get a quick description.
- **Clean docs URLs** — `docs.humanlayer.com` now serves extensionless URLs (e.g. `/guide/remote-daemons`); old `.html` links still resolve.

**Other Changes**

- **Drag-and-drop overlay fix** — The "drop files here" overlay now appears only in sessions attached to a task, where uploads actually work, instead of misleadingly showing on standalone sessions.
- **Markdown artifact guidance** — Agents now open Markdown artifacts by file name from the Artifacts sidebar rather than attempting inline previews.

## 0.120.1 — June 21, 2026

This release improves multi-repository workspaces and the first-run flow. It also fixes draft and editing issues. New users see a clear **Create Task** action. Multi-repository tasks now have a Workspace view and workspace-aware session launch.

**Highlights**

- **Multi-repo Workspace surfacing** — Multi-repo tasks get a new **Workspace** sidebar tab listing every repo (primary badged), a "Workspace Root · N repos" row on the task summary, and a workspace-aware working-directory picker when launching new sessions. Single-repo tasks are unchanged.
- **Cleaner first-run experience** — A workspace with no tasks now shows a centered "Create Task" empty state instead of empty Kanban columns, and the left sidebar stays hidden until you have a task of your own.
- **Auto-focus session prompt** — Prompt editor focuses on navigation into a writable session to help avoid accidental hotkey triggers when intent is to author a user message.

**Other Changes**

- **Draft body now persists** — Editing the body of an existing session draft and saving now keeps your changes (previously only the title was saved).
- **Remote daemon launch installs latest CLI** — The remote daemon launch command now installs the latest `@humanlayer/cli` before running. This fixes a bug where sometimes the installed humanlayer cli was not available.
- **Refined Repositories header** — Task form now lists only the names of the repos you actually selected, not every repo in the workspace.
- **Trust step in install command** — The `/install` command now includes a `brew trust --cask` line ahead of install.
- **Worktree setup points to implement-outline** — The `setup-worktree` flow now always suggests `/rpi:implement-outline` (never the retired `implement-plan`).

## 0.117.3 — June 19, 2026

This release protects unsaved drafts when you navigate away. It fixes an incorrect Claude Code fallback to an older Opus model. It also fixes auto-advance for some worktree tasks and adds this site at **docs.humanlayer.com**.

[Watch the release video](https://www.loom.com/share/b79f18be4900458e91c64ce3b89b0653)

**Highlights**

- **Unsaved drafts are protected** — Navigating away from a draft or new-task form now auto-saves, prompts you to save, or lets you pass through cleanly instead of silently dropping your work.
- **Claude Code stays on the latest Opus** — Fixed a bug where Claude Code sessions would sometimes default to Opus 4.5 instead of 4.8.
- **Auto-advance fix for worktree tasks** — Fixed a bug where auto-advance would not fire in some cases for tasks in a worktree.
- **New docs site** — Documentation now lives at [docs.humanlayer.com](https://docs.humanlayer.com), with pages for Overview, Remote daemons (CLI), and Codex CLI setup.

**Fixes**

- **Artifact sidebar sizing** — Sidebar previews no longer collapse on narrow screens; a responsive comment gutter keeps avatars visible.
- **Draft sessions hidden from sidebar** — The left-nav task tree excludes draft-status sessions, fixing stray entries and inaccurate unread/status.
- **`@humanlayer/cli` self-update runs in background** — Self-update no longer blocks app startup.

## 0.115.2 — June 17, 2026

Production builds now generate the correct remote-daemon launch command. The cloud install page now gives new users clearer steps.

**Highlights**

- **Correct production daemon launch command** — Production builds no longer emit `--beta` in the remote/browser daemon launch-token command, so the command copied from Settings → Daemons targets prod.
- **Revamped install/onboarding page** — The install page now leads with outcomes, answers common first questions inline, tells Linux/Windows users how to run the daemon from a browser, and fixes the Artifacts sidebar link.
- **Lighter welcome email** — The first onboarding email is now text-forward while keeping the product-tour link.

## 0.115.0 — June 17, 2026

This release adds a free plan for small teams. It adds Linear auto-advance to CodeLayer and Codex. It also improves the TDD design interview.

**Highlights**

- **Hobby free tier + one-click upgrade to Pro** — New first-class HumanLayer Hobby plan for small teams (up to 3 active members plus pending invites), with a Stripe-hosted Upgrade to Pro flow in Billing settings and tier-specific copy for Hobby, Pro, and Enterprise.
- **Linear auto-advance in CodeLayer and Codex** — Invoking an `rpi:*` skill now advances the linked Linear issue through your workflow columns in CodeLayer and Codex sessions, not just Claude Code.
- **TDD interview shows code, not prose** — The `create-tdd` program-design interview now defaults to a code block per option so you compare actual shapes side-by-side.

**Fixes**

- **Lowercase Linear ticket IDs** — Tickets like `core-123` now resolve and advance.
- **Freeform ticket linkage** — Freeform tasks created from a Linear or Jira ticket keep their ticket link.
- **Session UI selector gating** — The new session page hides the HumanLayer/Terminal UI selector when the Claude Code Terminal UI experiment is off.

## 0.105.0 — June 11, 2026

This release adds a read-only Kanban task board, editable queued messages, more team metrics, and Fable 5 model support.

[Watch the walkthrough video](https://www.loom.com/share/fd8bf5456cd64e84840d940acf36b44a)

**Highlights**

- **Kanban task board** — Tasks now appear in a read-only workflow board with Todo/Draft, Research & Design, Planning, Implementation, and In Review columns.
- **Editable queued messages** — Queued messages can now be edited in place before they are sent, with optimistic updates and graceful race handling.
- **Improved team metrics** — The metrics page adds weekly active-user charts, collaboration metrics, CSV export, and user drill-downs.
- **Fable 5 model support** — Adds Fable 5 to the Claude Code model dropdown.
- **Show skill contents** — Skill tool calls now expose injected Claude skill prompts in the tool modal.
- **Claude Code diagnostics** — Settings now shows Claude Code version and update information.
- **Model-aware context warnings** — Context-window warnings adjust based on the selected model.

**Fixes**

- **More reliable sync and left nav** — Fixed an issue where the left nav would not populate session data without a refresh.
- **Workflow graph stability** — Session nodes stay visible while dragging in the task-page workflow graph.
- **Billing-blocked daemon heartbeat** — Keeps daemon heartbeat behavior alive during billing-blocked states.
- **Queued message send-now flow** — Fixes queued-message send-now behavior.
- **Tool result modal updates** — Live-updates tool result modal content when tool responses arrive.
- **Auto-advance deduping** — Makes auto-advance timestamp-aware so rewound sessions advance correctly.
- **Session titles** — Uses `<phase>: <task name>` titles for auto-created phase sessions.
- **Org access requests** — Suppresses spurious access requests for existing org members and improves sign-in-first access screens.

## 0.101.7 — June 6, 2026

RPI is now the default workflow for new tasks. This release fixes worktree setup that could leave the main checkout as a bare repository. It also updates RPI skill prompts for Claude Opus 4.8.

**Highlights**

- **RPI is the new default workflow** — Fresh users now land on the Research → Plan → Implement workflow in the New Task form instead of Freeform.
- **Worktree setup no longer leaves your repo bare** — Fixes the bug where creating a task workspace could leave your main checkout acting as a bare repo, breaking `git pull` until manually repaired.
- **RPI skills updated for Claude Opus 4.8** — Removed references to the retired `TodoWrite` tool so the research, plan, and implement workflows behave correctly on Opus 4.8.
- **Daemon launch command fixed on production** — The Settings dialog no longer incorrectly includes `--beta` in the daemon launch command on production builds.

**Fixes**

- **File-mention autocomplete** — The `@` autocomplete dropdown stays confined to the window instead of getting clipped off the right edge.
- **Sidebar create buttons** — "Create Task" and "Create Session" are no longer hidden when the sidebar is empty or loading.
- **Artifact selection on session switch** — "Send & Resolve" and the artifact preview now reset when switching sessions instead of showing a stale artifact.
- **Removed dead `completed` status** — Sessions consistently show `READY`; the phantom `completed` state is gone.
- **Access-request archiving** — Archiving now correctly ends the notification lifecycle.
- **Cloud favicons** — The cloud dashboard and riptide-cloud now show a favicon in the browser tab.
