import type { SlashCommand } from '../components/slash-command-list'

/** `/compact` as the coding agent spells it. */
export const COMPACT_COMMAND = '/compact'

/**
 * A command the agent parses itself, rather than receiving as prompt text.
 *
 * Being one of these is what makes a command start-of-message only, so the flag is
 * pinned to `true` by the type rather than decided per entry: an entry cannot omit it,
 * and cannot claim otherwise.
 */
export interface SystemSlashCommand extends SlashCommand {
	startOfMessageOnly: true
}

/**
 * Commands the coding agent acts on itself, instead of receiving as prompt text.
 *
 * The skill commands are rewritten into prose by `getTextFromContent` before they are
 * sent, so the agent sees an ordinary prompt and they work in any position. These are
 * not: they reach the agent verbatim, and the agent only reads them at the start of a
 * message. `parseCompactCommand` in agentlayer-core anchors `/compact` at both ends,
 * so it has to be the whole message. Everything on this list is therefore
 * `startOfMessageOnly`, and the composer hides it once the message has started.
 *
 * This list is written by hand. Nothing reads the agent's real command list, so it can
 * drift: the agent supports more of these than are offered here, `/clear` among them.
 * The Claude Agent SDK can enumerate its commands via `supportedCommands()`, but the
 * result carries no position information, so that alone would not replace this file.
 * Add a command here when it should appear in the menu.
 */
export const SYSTEM_SLASH_COMMANDS: SystemSlashCommand[] = [
	{ name: COMPACT_COMMAND, source: 'bundled', startOfMessageOnly: true },
]
