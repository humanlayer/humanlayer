import type { AgentDefinition } from './types'

function yamlFolded(value: string): string {
	return value
		.split('\n')
		.map((line) => `  ${line}`)
		.join('\n')
}

export function renderAgentMarkdown(name: string, agent: AgentDefinition): string {
	const lines = ['---', `name: ${name}`, 'description: |', yamlFolded(agent.description)]

	if (agent.tools?.length) {
		lines.push(`tools: ${JSON.stringify(agent.tools)}`)
	}

	if (agent.model) {
		lines.push(`model: ${agent.model}`)
	}

	lines.push('---', '', agent.prompt, '')

	return lines.join('\n')
}
