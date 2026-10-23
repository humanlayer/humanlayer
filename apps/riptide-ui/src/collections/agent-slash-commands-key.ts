import type { AgentSlashCommands } from '@humanlayer/db/tables/agent-slash-commands'

export function getAgentSlashCommandsKey(
	row: Pick<AgentSlashCommands, 'organization_id' | 'user_id' | 'host_id' | 'agent' | 'workspace_path'>,
): string {
	return JSON.stringify([row.organization_id, row.user_id, row.host_id, row.agent, row.workspace_path])
}
