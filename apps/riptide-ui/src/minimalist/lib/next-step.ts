import { NextStepSuggestionSchema } from '@humanlayer/db/zodschemas/next-step'
import { RPI_SKILLS } from '@humanlayer/ui/constants/rpi-skills'

type NextStep = {
	/** What the next session does, as a short imperative ("Write the plan"). */
	action: string
	/** The slash command the new session starts with, when the step is an RPI skill. */
	command: string | null
	/** The label the new session gets, used to find a session that already started. */
	targetLabel: string | null
	/** The full first message for the new session. */
	prompt: string
	suggestedDirectory: string | null
}

const ACTIONS = {
	'create-research-questions': 'Write the research questions',
	'iterate-research-questions': 'Revise the research questions',
	'create-research': 'Research the codebase',
	'iterate-research': 'Revise the research',
	'create-design-discussion': 'Discuss the design',
	'iterate-design-discussion': 'Revise the design',
	'create-prd': 'Write the PRD',
	'create-tdd': 'Write the technical design',
	'create-structure-outline': 'Outline the changes',
	'iterate-structure-outline': 'Revise the outline',
	'create-plan': 'Write the plan',
	'iterate-plan': 'Revise the plan',
	'setup-worktree': 'Set up the worktree',
	'implement-plan': 'Implement the plan',
	'implement-outline': 'Implement the outline',
	'iterate-implementation': 'Revise the implementation',
	'describe-pr': 'Describe the pull request',
}

/**
 * The next step the agent suggested at the end of a session, or null. Electric
 * may deliver the JSON column as a string, so both shapes parse.
 */
export function parseNextStep(raw: unknown): NextStep | null {
	let list: unknown = raw
	if (typeof raw === 'string') {
		try {
			list = JSON.parse(raw)
		} catch {
			return null
		}
	}
	if (!Array.isArray(list) || !list[0]) return null
	const parsed = NextStepSuggestionSchema.safeParse(list[0])
	if (!parsed.success || parsed.data.extraction.type !== 'next_step_found') return null
	const step = parsed.data.extraction
	const skill = RPI_SKILLS.find((entry) => entry.skillId === step.nextStepType)
	const command = skill ? `/${skill.name}` : null
	return {
		action:
			(step.nextStepType in ACTIONS ? ACTIONS[step.nextStepType as keyof typeof ACTIONS] : null) ??
			step.nextStepSummary,
		command,
		targetLabel: skill?.label.name ?? null,
		prompt: firstMessage(step.nextStepPrompt, skill?.name ?? null),
		suggestedDirectory: step.suggestedDirectory ?? null,
	}
}

/** The prompt as a slash command: "use the rpi:create-plan skill for X" becomes "/rpi:create-plan for X". */
function firstMessage(prompt: string, skillName: string | null): string {
	const text = prompt.trim()
	if (!skillName || text.startsWith('/')) return text
	const prefix = `use the ${skillName} skill`
	if (text.toLowerCase().startsWith(prefix)) return `/${skillName} ${text.slice(prefix.length).trim()}`.trim()
	return `/${skillName} ${text}`.trim()
}
