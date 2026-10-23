# Sub-agent models and effort

RPI skills run in the main session. Some skills launch a sub-agent for a focused task. The session's coding agent controls the sub-agent model and effort rules.

The two main rules are:

- **Claude Code:** Most RPI sub-agents use a fixed Claude model family. Only agents marked `inherit` use the parent model.
- **Codex:** Every sub-agent uses the parent GPT model. Most use low effort. The outline implementer uses the parent effort.

Model and effort are separate settings. A sub-agent can use the parent model at lower effort. It can also use another model family with the session's Claude thinking settings.

For the role of sub-agents in each phase, read [How workflow phases fit together](/explanation/workflow-phases). For each skill's exact behavior, read the [skills and workflows reference](/reference/skills-workflows).

## Claude Code

### Model selection

HumanLayer registers these RPI sub-agents for Claude Code sessions:

| Sub-agent | Model |
| --- | --- |
| `codebase-analyzer` | Sonnet, or Haiku with Faster Research Subagents |
| `codebase-locator` | Sonnet, or Haiku with Faster Research Subagents |
| `codebase-pattern-finder` | Sonnet, or Haiku with Faster Research Subagents |
| `web-search-researcher` | Sonnet |
| `implementer-agent` | Sonnet |
| `implementation-reviewer` | Sonnet |
| `outline-implementer-agent` | Parent model (`inherit`) |

`sonnet`, `haiku`, and `inherit` are Claude Code model aliases. Claude Code resolves Sonnet and Haiku to the model behind each alias. `inherit` uses the exact main-session model.

No RPI sub-agent uses a fixed Opus model. If the parent uses Opus, the skill runs on Opus. Only `outline-implementer-agent` also uses Opus. The other named sub-agents use Sonnet or Haiku.

Fable follows the same rule. With a Fable parent, `outline-implementer-agent` uses Fable. The fixed-model sub-agents use Sonnet or Haiku.

A Haiku parent can therefore launch a Sonnet implementer. A fixed child model does not use the parent model family.

### Effort

HumanLayer sends the selected effort to Claude Code. It does not set a separate effort for each RPI sub-agent.

Claude Code manages child thinking separately from the model alias. The current bundled version sends the main session's extended-thinking settings to the sub-agent.

When no effort is set, Claude Code uses the model default. A direct SDK learning test used an Opus 5 `outline-implementer-agent` with `model: inherit`. Each child request used `medium` effort when the test set no effort.

The exact rules are:

- `model: inherit` controls the model. It does not control effort.
- The main Claude session supplies the child's thinking settings.
- HumanLayer does not add an RPI-specific Claude effort setting.
- Claude Code and the selected model set the final child effort when the session does not set one.

### Faster Research Subagents

The **Faster Research Subagents** switch is in **Settings -> Experiments**. The user's setting and the organization's setting must both allow it.

When enabled, it changes only these three agents from Sonnet to Haiku:

- `codebase-analyzer`
- `codebase-locator`
- `codebase-pattern-finder`

It does not change:

- the parent session model
- `web-search-researcher`
- either implementation agent
- `implementation-reviewer`
- Codex sub-agents

Use the switch when code search speed and cost are more important than Sonnet's added analysis. Turn it off when the research task needs Sonnet's stronger code analysis.

## Codex

Codex sessions run through CodeLayer. Every child uses the exact GPT model selected for the parent. Changing the parent GPT model changes all its sub-agents.

| Sub-agent | Model | Effort |
| --- | --- | --- |
| `general-purpose` | Same model as parent | Low |
| `bash` | Same model as parent | Low |
| `codebase-analyzer` | Same model as parent | Low |
| `codebase-locator` | Same model as parent | Low |
| `codebase-pattern-finder` | Same model as parent | Low |
| `web-search-researcher` | Same model as parent | Low |
| `implementer-agent` | Same model as parent | Low |
| `outline-implementer-agent` | Same model as parent | Same effort as parent |

For example, a GPT parent at `high` effort starts research and standard implementation sub-agents at `low`. The children use the same GPT model. The outline implementer uses that model at `high`.

If the parent uses `low`, the standard child stays at `low`. HumanLayer does not increase the effort.

Codex **Fast Mode** is separate from **Faster Research Subagents**. Fast Mode uses the Codex session setting. Faster Research Subagents changes only the three Claude Code research agents listed earlier.

## Parent examples

| Parent session | Research sub-agent | Standard implementer | Outline implementer |
| --- | --- | --- | --- |
| Claude Code, Opus | Sonnet or Haiku | Sonnet | Opus |
| Claude Code, Fable | Sonnet or Haiku | Sonnet | Fable |
| Claude Code, Sonnet | Sonnet or Haiku | Sonnet | Parent Sonnet model |
| Claude Code, Haiku | Sonnet or Haiku | Sonnet | Parent Haiku model |
| Codex, GPT at high effort | Same GPT at low | Same GPT at low | Same GPT at high |
| Codex, GPT at low effort | Same GPT at low | Same GPT at low | Same GPT at low |

## What this page does not cover

The HumanLayer Library Researcher uses a separate managed cloud workflow. It does not use the local parent model. Faster Research Subagents does not affect it.

Project-defined and user-defined sub-agents can set their own model and effort. Check each agent definition instead of using the defaults on this page.

For Claude's `model`, `inherit`, and `effort` fields, see the [Claude Agent SDK sub-agent reference](https://platform.claude.com/docs/en/agent-sdk/subagents#agentdefinition-configuration).
