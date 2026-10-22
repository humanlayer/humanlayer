import type { Command } from 'commander'
import { createCli } from 'trpc-cli'

import type { EnvironmentName } from '../lib/macros'
import { createLazyClient } from './lazy-client'
import { createProxyRouter } from './proxy-router'

/** Convenience flag definition: CLI flag name, column name in the DB */
type ConvenienceFlag = { flag: string; description: string; optKey: string; column: string }

const SESSION_ID_FLAG: ConvenienceFlag = {
	flag: '--session-id <ids>',
	description: 'Filter by session ID(s), comma-separated',
	optKey: 'sessionId',
	column: 'session_id',
}
const TASK_ID_FLAG: ConvenienceFlag = {
	flag: '--task-id <ids>',
	description: 'Filter by task ID(s), comma-separated',
	optKey: 'taskId',
	column: 'task_id',
}

/** Map of sync subcommand name → convenience flags to add */
const SYNC_CONVENIENCE_FLAGS = {
	'conversation-events': [SESSION_ID_FLAG, TASK_ID_FLAG],
	sessions: [TASK_ID_FLAG],
	approvals: [SESSION_ID_FLAG, TASK_ID_FLAG],
	artifacts: [TASK_ID_FLAG],
	'artifacts-metadata': [TASK_ID_FLAG],
	'artifact-comments': [TASK_ID_FLAG],
}

/**
 * Add ergonomic filter flags to sync subcommands so users don't have
 * to hand-craft --where JSON blobs.
 */
function addSyncConvenienceFlags(apiProgram: Command) {
	const syncCmd = apiProgram.commands.find((command) => command.name() === 'sync')
	if (!syncCmd) return

	for (const [cmdName, flags] of Object.entries(SYNC_CONVENIENCE_FLAGS)) {
		const cmd = syncCmd.commands.find((command) => command.name() === cmdName)
		if (!cmd) continue

		for (const f of flags) cmd.option(f.flag, f.description)

		cmd.hook('preAction', (thisCommand: Command) => {
			const opts = thisCommand.opts()
			if (opts.where || flags.every((f) => !opts[f.optKey])) return

			const conditions: { type: 'comparison'; field: string[]; operator: string; value: unknown }[] = []
			for (const f of flags) {
				const raw = opts[f.optKey] as string | undefined
				if (!raw) continue
				const ids = raw.split(',').map((s: string) => s.trim())
				conditions.push(
					ids.length === 1
						? { type: 'comparison', field: [f.column], operator: 'eq', value: ids[0] }
						: { type: 'comparison', field: [f.column], operator: 'in', value: ids },
				)
			}

			const where = conditions.length === 1 ? conditions[0] : { type: 'and', conditions }
			thisCommand.setOptionValue('where', where)
		})
	}
}

/**
 * Clean up trpc-cli's auto-generated option descriptions:
 * - Strip JSON schema dumps (Any of: [...], Pattern: ..., Format: uuid)
 * - Remove "; type: string or null" noise from nullable fields
 * - Add [required] label for required options (those using <> brackets)
 */
/** Options we added manually — should not get [required] labels */
const CONVENIENCE_FLAG_NAMES = new Set(['--session-id', '--task-id'])

function cleanupOptionHelp(cmd: Command) {
	for (const opt of cmd.options) {
		let desc = opt.description ?? ''
		// Strip "; Any of: [...]" JSON schema dumps
		desc = desc.replace(/;\s*Any of:\s*\[.*$/s, '')
		// Strip "; type: string or null" → just keep base description
		desc = desc.replace(/;\s*type:\s*string or null\b/, '')
		// Strip "Format: uuid; Pattern: ..." noise
		desc = desc.replace(/;\s*Format:\s*uuid\b/, '')
		desc = desc.replace(/;\s*Pattern:\s*\S+/, '')
		// Clean up numeric range descriptions
		desc = desc.replace(/^Exclusive minimum:\s*\d+;\s*Maximum:\s*(\d+)$/, 'max $1')
		desc = desc.replace(/;?\s*Exclusive minimum:\s*\d+;\s*Maximum:\s*(\d+)/, ' (max $1)')
		desc = desc.replace(/^Minimum:\s*\d+$/, '')
		desc = desc.replace(/;?\s*Minimum:\s*\d+/, '')
		// Simplify sorts description
		desc = desc.replace(/Type: object;\s*Object \(json formatted\);\s*Required:.*?array/, 'JSON sort objects')
		// Add [required] for required options, but not our manually-added convenience flags
		const longFlag = opt.long ?? opt.flags.match(/--([\w-]+)/)?.[0]
		if (opt.flags.includes('<') && !CONVENIENCE_FLAG_NAMES.has(longFlag ?? '') && !desc.includes('[required]')) {
			desc = `[required] ${desc}`
		}
		opt.description = desc.trim()
	}
	for (const sub of cmd.commands) {
		cleanupOptionHelp(sub)
	}
}

export function registerApiCommand(program: Command, getEnv: () => EnvironmentName) {
	const getClient = createLazyClient(getEnv)
	const router = createProxyRouter(getClient)

	const cli = createCli({
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		router: router as any,
		name: 'api',
		description: 'Call HumanLayer API endpoints',
	})

	// trpc-cli exposes a deliberately narrow CommanderProgramLike return type. Its
	// implementation constructs a Commander Command and documents this escape hatch.
	const apiProgram = cli.buildProgram() as Command
	addSyncConvenienceFlags(apiProgram)
	cleanupOptionHelp(apiProgram)
	program.addCommand(apiProgram)
}
