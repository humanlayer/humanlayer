export type CanonicalArtifactOperation = 'Read' | 'Write' | 'Edit' | 'MultiEdit'

export interface NormalizedSkillToolInput {
	skill: string
	args?: string
}

const FILE_OPERATION_TOOLS = new Set(['read', 'write', 'edit', 'multiedit'])
const AGENT_TOOLS = new Set(['task', 'agent', 'subagent', 'functionsagent'])

export function normalizeToolName(name: string | undefined | null): string {
	return name?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
}

export function toCanonicalOperation(
	toolName: string | undefined | null,
): CanonicalArtifactOperation | undefined {
	switch (normalizeToolName(toolName)) {
		case 'read':
			return 'Read'
		case 'write':
			return 'Write'
		case 'edit':
			return 'Edit'
		case 'multiedit':
			return 'MultiEdit'
		default:
			return undefined
	}
}

export function isFileOperationTool(toolName: string | undefined | null): boolean {
	return FILE_OPERATION_TOOLS.has(normalizeToolName(toolName))
}

export function isApplyPatchTool(toolName: string | undefined | null): boolean {
	return normalizeToolName(toolName) === 'applypatch'
}

export function isAgentToolName(toolName: string | undefined | null): boolean {
	return AGENT_TOOLS.has(normalizeToolName(toolName))
}

export function normalizeSkillToolInput(input: unknown): NormalizedSkillToolInput | null {
	if (!input || typeof input !== 'object') return null

	const rawInput = input as { skill?: unknown; name?: unknown; args?: unknown }
	const skill = [rawInput.skill, rawInput.name].find(
		(value): value is string => typeof value === 'string' && value.length > 0,
	)
	if (!skill) return null

	return {
		skill,
		...(typeof rawInput.args === 'string' ? { args: rawInput.args } : {}),
	}
}
