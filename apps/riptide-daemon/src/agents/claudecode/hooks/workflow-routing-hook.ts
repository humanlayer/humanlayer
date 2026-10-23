import type { HookCallback, HookInput, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import type { TaskWorkflowType, WorktreeTiming } from '@humanlayer/schemas/effect/taskconfiguration'

export function getWorkflowRoutingSkillName(toolName: string, toolInput: unknown): string | null {
	if (toolName !== 'Skill' && toolName !== 'skill') return null
	if (typeof toolInput === 'object' && toolInput !== null) {
		const input = toolInput as { name?: string; skill?: string }
		return input.skill || input.name || null
	}
	return null
}

const outlineResponseInstructions = `- After creating a new outline, include this next step.
- When revising an existing outline, describe the changes without repeating the next step.
- If the user explicitly asks what to do next, provide this next step.
- Loading the skill again is not a reason to repeat the suggestion.`

// Workflow-type-independent routing rules. These are consulted before the per-workflow_type
// map, so they fire regardless of the task's workflow_type (including oneshot, freeform, and null).
const skillRoutingRules: Array<{
	skills: string[]
	contextByTiming: Record<WorktreeTiming, string | null>
}> = [
	{
		skills: ['rpi:create-structure-outline', 'rpi:iterate-structure-outline'],
		contextByTiming: {
			later: `The next workflow step is /rpi:setup-worktree to set up a git worktree before implementation.

${outlineResponseInstructions}

for example:

\`\`\`text
/rpi:setup-worktree
\`\`\``,
			now: `The next workflow step is /rpi:implement-outline to implement directly from the outline.

${outlineResponseInstructions}

for example:

\`\`\`text
/rpi:implement-outline
\`\`\``,
			never: `The next workflow step is /rpi:implement-outline to implement directly from the outline.

${outlineResponseInstructions}

for example:

\`\`\`text
/rpi:implement-outline
\`\`\``,
		},
	},
]

const workflowRoutingContextRules: Record<
	TaskWorkflowType,
	Array<{ skills: string[]; contextByTiming: Record<WorktreeTiming, string | null> }>
> = {
	rpi: [
		{
			skills: ['rpi:create-plan', 'rpi:iterate-plan'],
			contextByTiming: {
				later: null,
				now: `This task does not need a deferred worktree setup session. When you finish the implementation plan, suggest /rpi:implement-plan as the next step.

for example:

\`\`\`text
/rpi:implement-plan
\`\`\``,
				never: `This task does not need a deferred worktree setup session. When you finish the implementation plan, suggest /rpi:implement-plan as the next step.

for example:

\`\`\`text
/rpi:implement-plan
\`\`\``,
			},
		},
	],
	outline_only: [],
	prd_tdd: [
		{
			skills: ['rpi:create-research', 'rpi:iterate-research'],
			contextByTiming: {
				later: `This task uses the PRD-oriented workflow. When you finish the research document, suggest /rpi:create-prd as the next step to create a Product Requirements Document.

for example:

\`\`\`text
/rpi:create-prd
\`\`\``,
				now: `This task uses the PRD-oriented workflow. When you finish the research document, suggest /rpi:create-prd as the next step to create a Product Requirements Document.

for example:

\`\`\`text
/rpi:create-prd
\`\`\``,
				never: `This task uses the PRD-oriented workflow. When you finish the research document, suggest /rpi:create-prd as the next step to create a Product Requirements Document.

for example:

\`\`\`text
/rpi:create-prd
\`\`\``,
			},
		},
	],
	oneshot: [],
	freeform: [],
}

export function getWorkflowRoutingContext(
	workflowType: TaskWorkflowType | null,
	worktreeTiming: WorktreeTiming | null,
	skillName: string | null,
	isInWorktree = false,
): string | null {
	if (!skillName) return null

	// A session already running inside a worktree has nothing to set up, so it routes
	// straight to implementation regardless of the task's configured timing.
	const timing = isInWorktree ? 'now' : (worktreeTiming ?? 'later')

	const skillRule = skillRoutingRules.find((candidate) => candidate.skills.includes(skillName))
	if (skillRule) return skillRule.contextByTiming[timing] ?? null

	if (!workflowType) return null

	const rule = workflowRoutingContextRules[workflowType].find((candidate) => candidate.skills.includes(skillName))
	return rule?.contextByTiming[timing] ?? null
}

export function createWorkflowRoutingHook(
	workflowType: TaskWorkflowType | null,
	worktreeTiming: WorktreeTiming | null = null,
	isInWorktree = false,
): HookCallback {
	return async (
		input: HookInput,
		_toolUseID: string | undefined,
		_options: { signal: AbortSignal },
	): Promise<HookJSONOutput> => {
		if (input.hook_event_name !== 'PostToolUse') {
			return { continue: true }
		}

		const toolName = (input as { tool_name?: string }).tool_name ?? ''
		const skillName = getWorkflowRoutingSkillName(toolName, input.tool_input)
		const additionalContext = getWorkflowRoutingContext(workflowType, worktreeTiming, skillName, isInWorktree)

		if (!additionalContext) {
			return { continue: true }
		}

		return {
			continue: true,
			hookSpecificOutput: {
				hookEventName: 'PostToolUse',
				additionalContext,
			},
		}
	}
}
