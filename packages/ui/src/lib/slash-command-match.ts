import type { SlashCommand } from '@humanlayer/ui/components/slash-command-list'

/**
 * Match slash commands by prefix, anchored to a segment boundary.
 *
 * The generic `fuzzySearch` matcher accepts any subsequence, which is wrong for a short
 * command list reached by typing `/`: the query `home` (from a path like `/home/pepijn`)
 * matches `/hl:show-me`, because h-o-m-e appear in that order. The menu then opens over a
 * path and steals the next Enter.
 *
 * A segment-anchored prefix keeps the useful matches and drops the accidental ones:
 *   comp            -> /compact
 *   research        -> /rpi:create-research
 *   create-research -> /rpi:create-research
 *   home            -> (nothing)
 *
 * `atStartOfMessage` drops commands the agent only parses at the start of a message
 * (see `SlashCommand.startOfMessageOnly`), so they are never offered in a position
 * where picking them would do nothing.
 */
export function matchSlashCommands(
	commands: SlashCommand[],
	query: string,
	{ atStartOfMessage }: { atStartOfMessage: boolean },
): SlashCommand[] {
	const available = atStartOfMessage
		? commands
		: commands.filter((command) => !command.startOfMessageOnly)

	const needle = query.trim().toLowerCase()
	if (!needle) return available

	const ranked: Array<{ command: SlashCommand; rank: number; offset: number }> = []
	for (const command of available) {
		const name = command.name.replace(/^\//, '').toLowerCase()
		const offset = segmentOffsets(name).find((start) => name.startsWith(needle, start))
		if (offset !== undefined) {
			ranked.push({ command, rank: NAME_MATCH_RANK, offset })
			continue
		}

		const descriptionOffset = matchDescription(command.description, needle)
		if (descriptionOffset !== undefined) {
			ranked.push({ command, rank: DESCRIPTION_MATCH_RANK, offset: descriptionOffset })
		}
	}

	return ranked
		.sort(
			(left, right) =>
				left.rank - right.rank ||
				left.offset - right.offset ||
				left.command.name.length - right.command.name.length,
		)
		.map((entry) => entry.command)
}

const NAME_MATCH_RANK = 0
const DESCRIPTION_MATCH_RANK = 1

function matchDescription(description: string | undefined, needle: string): number | undefined {
	if (!description) return undefined
	const haystack = description.toLowerCase()

	let index = haystack.indexOf(needle)
	while (index !== -1) {
		const previous = index === 0 ? '' : haystack[index - 1]
		if (index === 0 || previous === undefined || !/[a-z0-9]/.test(previous)) return index
		index = haystack.indexOf(needle, index + 1)
	}
	return undefined
}

/** Index 0 plus every index just after a `:` or `-`, so `rpi:create-research` opens at 3 and 10 too. */
function segmentOffsets(name: string): number[] {
	const offsets = [0]
	for (let index = 0; index < name.length; index++) {
		const char = name[index]
		if (char === ':' || char === '-') offsets.push(index + 1)
	}
	return offsets
}
