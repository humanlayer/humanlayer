import {
	HOST_LEVEL_WORKSPACE_PATH,
	type AgentCommand,
	type AgentCommandScope,
	type AgentSkill,
} from '@humanlayer/db/tables/agent-slash-commands'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { SlashCommand } from '@humanlayer/ui/components/rich-text-editor'
import { and, eq, useLiveQuery } from '@tanstack/react-db'
import { useQuery } from '@tanstack/react-query'
import { useDebounce } from '@uidotdev/usehooks'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useRiptideApi } from '@/orpc/client'

// Keep in sync with `SYSTEM_SLASH_COMMANDS`, which marks the same built-ins.
const START_OF_MESSAGE_ONLY_COMMANDS = new Set(['compact', 'clear'])

const DISCOVERY_REQUEST_DEBOUNCE_MS = 500

function sourceForScope(scope: AgentCommandScope | undefined): SlashCommand['source'] {
	return scope === 'user' ? 'global' : 'local'
}

function toSlashCommand(command: AgentCommand): SlashCommand {
	const name = command.name.replace(/^\//, '')
	const slashCommand: SlashCommand = { name: `/${name}`, source: sourceForScope(command.scope) }
	if (command.description) slashCommand.description = command.description
	if (START_OF_MESSAGE_ONLY_COMMANDS.has(name.toLowerCase())) slashCommand.startOfMessageOnly = true
	return slashCommand
}

function skillToSlashCommand(skill: AgentSkill): SlashCommand {
	const slashCommand: SlashCommand = {
		name: `/${skill.name.replace(/^\//, '')}`,
		source: sourceForScope(skill.scope),
	}
	if (skill.description) slashCommand.description = skill.description
	return slashCommand
}

function firstByName(...groups: SlashCommand[][]): SlashCommand[] {
	const byName = new Map<string, SlashCommand>()
	for (const group of groups) {
		for (const command of group) {
			const key = command.name.toLowerCase()
			if (!byName.has(key)) byName.set(key, command)
		}
	}
	return [...byName.values()]
}

export function useAgentSlashCommands({
	hostId,
	agent,
	workspacePath,
	fallbackCommands,
	omitStartOfMessageOnly = false,
}: {
	hostId: string | null | undefined
	agent: CodingAgent | null | undefined
	workspacePath: string | null | undefined
	fallbackCommands: SlashCommand[]
	omitStartOfMessageOnly?: boolean
}): SlashCommand[] {
	const { agentSlashCommandsCollection } = useSync()
	const discoveryEnabled = useSettingsStore((state) => state.agentCommandDiscoveryEnabled)

	const result = useLiveQuery(
		(q) => {
			if (!hostId || !agent || !discoveryEnabled) return undefined
			return q
				.from({ rows: agentSlashCommandsCollection })
				.select(({ rows }) => ({
					workspace_path: rows.workspace_path,
					commands: rows.commands,
					skills: rows.skills,
				}))
				.where(({ rows }) => and(eq(rows.host_id, hostId), eq(rows.agent, agent)))
		},
		[agentSlashCommandsCollection, hostId, agent, discoveryEnabled],
	)

	const rows = result.data
	useDiscoverWorkspaceAgentCommands({
		hostId,
		agent,
		workspacePath,
		enabled: discoveryEnabled && result.isReady,
		reportedWorkspacePaths: rows?.map((row) => row.workspace_path) ?? [],
	})

	return useMemo(() => {
		if (!discoveryEnabled || !hostId || !agent || !rows || rows.length === 0) return fallbackCommands

		const workspaceRow = workspacePath ? rows.find((row) => row.workspace_path === workspacePath) : undefined
		const hostRow = rows.find((row) => row.workspace_path === HOST_LEVEL_WORKSPACE_PATH)

		const discovered = [workspaceRow, hostRow].filter((row) => row !== undefined)
		if (discovered.length === 0) return fallbackCommands

		// The agent lists skills among its commands too, without scope; the on-disk skill entry wins.
		const merged = firstByName(
			...discovered.map((row) => [...row.skills.map(skillToSlashCommand), ...row.commands.map(toSlashCommand)]),
			fallbackCommands,
		)
		return omitStartOfMessageOnly ? merged.filter((command) => !command.startOfMessageOnly) : merged
	}, [discoveryEnabled, hostId, agent, rows, workspacePath, fallbackCommands, omitStartOfMessageOnly])
}

// Sessions report their own working directory, which for a worktree is never the repo the
// composer selects, so ask the daemon for the selected directory directly.
function useDiscoverWorkspaceAgentCommands({
	hostId,
	agent,
	workspacePath,
	enabled,
	reportedWorkspacePaths,
}: {
	hostId: string | null | undefined
	agent: CodingAgent | null | undefined
	workspacePath: string | null | undefined
	enabled: boolean
	reportedWorkspacePaths: string[]
}) {
	const { queryClient: api } = useRiptideApi()
	const settledWorkspacePath = useDebounce(workspacePath?.trim() ?? '', DISCOVERY_REQUEST_DEBOUNCE_MS)
	const alreadyReported = reportedWorkspacePaths.includes(settledWorkspacePath)

	useQuery({
		...api.agentCommands.discoverWorkspace.queryOptions({
			input: { hostId: hostId ?? '', agent: 'claude', workspacePath: settledWorkspacePath },
			context: { silent: true },
		}),
		enabled: enabled && !!hostId && agent === 'claude' && settledWorkspacePath.length > 0 && !alreadyReported,
		refetchOnWindowFocus: false,
		retry: false,
	})
}
