import type { SlashCommand } from '../components/slash-command-list'
import type { SessionLabel } from '../components/session-label-badge'

/**
 * RPI Skill definition - single source of truth for skill metadata
 */
export interface RpiSkill {
	/** Full command name with prefix (e.g., 'rpi:create-research-questions') */
	name: string
	/** Skill ID without prefix (e.g., 'create-research-questions') */
	skillId: string
	/** Session label for this skill */
	label: SessionLabel
	/** Button text for next step prompts */
	buttonText: string
}

const RPI_SKILL_ALIASES = [
	{
		name: 'rpi:create-worktree',
		insertText: '/rpi:setup-worktree',
	},
	{
		name: 'rpi:configure-workspace',
		insertText: '/rpi:configure-workspaces',
	},
	{
		name: 'rpi:create-research-plan',
		insertText: '/rpi:create-research-questions',
	},
	{
		name: 'rpi:create-outline',
		insertText: '/rpi:create-structure-outline',
	},
	{
		name: 'rpi:iterate-outline',
		insertText: '/rpi:iterate-structure-outline',
	},
] as const

/**
 * Complete list of RPI workflow skills
 * This is the single source of truth for RPI skill metadata in the UI
 */
export const RPI_SKILLS: readonly RpiSkill[] = [
	// Research phase
	{
		name: 'rpi:create-research-questions',
		skillId: 'create-research-questions',
		label: { name: 'rpi:research-questions', title: 'research-questions' },
		buttonText: 'proceed to research questions',
	},
	{
		name: 'rpi:iterate-research-questions',
		skillId: 'iterate-research-questions',
		label: { name: 'rpi:research-questions', title: 'research-questions' },
		buttonText: 'iterate research questions',
	},
	{
		name: 'rpi:create-research',
		skillId: 'create-research',
		label: { name: 'rpi:research', title: 'research' },
		buttonText: 'proceed to research',
	},
	{
		name: 'rpi:iterate-research',
		skillId: 'iterate-research',
		label: { name: 'rpi:research', title: 'research' },
		buttonText: 'iterate research',
	},
	// Design phase
	//
	// NOTE: the order of phases below is load-bearing. RPI_LABELS derives its
	// progression rank from the order labels first appear here, so phases must be
	// listed in progression order: design < design-prd < design-tdd < structure.
	{
		name: 'rpi:create-design-discussion',
		skillId: 'create-design-discussion',
		label: { name: 'rpi:design', title: 'design' },
		buttonText: 'proceed to design',
	},
	{
		name: 'rpi:iterate-design-discussion',
		skillId: 'iterate-design-discussion',
		label: { name: 'rpi:design', title: 'design' },
		buttonText: 'iterate design',
	},
	// PRD phase (optional product-focused design)
	{
		name: 'rpi:create-prd',
		skillId: 'create-prd',
		label: { name: 'rpi:design-prd', title: 'design-prd' },
		buttonText: 'proceed to PRD',
	},
	{
		name: 'rpi:iterate-prd',
		skillId: 'iterate-prd',
		label: { name: 'rpi:design-prd', title: 'design-prd' },
		buttonText: 'iterate PRD',
	},
	// TDD phase (optional technical design bridging PRD to implementation)
	{
		name: 'rpi:create-tdd',
		skillId: 'create-tdd',
		label: { name: 'rpi:design-tdd', title: 'design-tdd' },
		buttonText: 'proceed to TDD',
	},
	{
		name: 'rpi:iterate-tdd',
		skillId: 'iterate-tdd',
		label: { name: 'rpi:design-tdd', title: 'design-tdd' },
		buttonText: 'iterate TDD',
	},
	// Structure phase
	{
		name: 'rpi:create-structure-outline',
		skillId: 'create-structure-outline',
		label: { name: 'rpi:structure', title: 'structure' },
		buttonText: 'proceed to outline',
	},
	{
		name: 'rpi:iterate-structure-outline',
		skillId: 'iterate-structure-outline',
		label: { name: 'rpi:structure', title: 'structure' },
		buttonText: 'iterate outline',
	},
	// Plan phase
	{
		name: 'rpi:create-plan',
		skillId: 'create-plan',
		label: { name: 'rpi:plan', title: 'plan' },
		buttonText: 'write plan',
	},
	{
		name: 'rpi:iterate-plan',
		skillId: 'iterate-plan',
		label: { name: 'rpi:plan', title: 'plan' },
		buttonText: 'iterate plan',
	},
	// Implementation phase
	{
		name: 'rpi:configure-workspaces',
		skillId: 'configure-workspaces',
		label: { name: 'rpi:worktree-setup', title: 'worktree-setup' },
		buttonText: 'configure workspaces',
	},
	{
		name: 'rpi:setup-worktree',
		skillId: 'setup-worktree',
		label: { name: 'rpi:worktree-setup', title: 'worktree-setup' },
		buttonText: 'setup worktree',
	},
	{
		name: 'rpi:implement-plan',
		skillId: 'implement-plan',
		label: { name: 'rpi:implementation', title: 'implementation' },
		buttonText: 'implement',
	},
	{
		name: 'rpi:implement-outline',
		skillId: 'implement-outline',
		label: { name: 'rpi:implementation', title: 'implementation' },
		buttonText: 'implement from outline',
	},
	{
		name: 'rpi:iterate-implementation',
		skillId: 'iterate-implementation',
		label: { name: 'rpi:implementation', title: 'implementation' },
		buttonText: 'iterate implementation',
	},
	// PR phase
	{
		name: 'rpi:describe-pr',
		skillId: 'describe-pr',
		label: { name: 'rpi:describe-pr', title: 'describe-pr' },
		buttonText: 'create pull request',
	},
	{
		name: 'rpi:ci-commit',
		skillId: 'ci-commit',
		label: { name: 'rpi:implementation', title: 'implementation' },
		buttonText: 'commit changes',
	},
	// Review phase (standalone, not part of main workflow)
	{
		name: 'rpi:review-artifact-comments',
		skillId: 'review-artifact-comments',
		label: { name: 'rpi:review', title: 'review' },
		buttonText: 'review comments',
	},
] as const

/**
 * Slash commands derived from RPI skills for use with RichTextEditor
 * Names include leading slash so they display and send correctly (e.g., '/rpi:create-plan')
 * Aliases are defined separately so workflow metadata stays canonical-only.
 */
export const RPI_SLASH_COMMANDS: SlashCommand[] = [
	...RPI_SKILLS.map((skill) => ({
		name: `/${skill.name}`,
		source: 'bundled' as const,
	})),
	...RPI_SKILL_ALIASES.map((alias) => ({
		name: `/${alias.name}`,
		source: 'bundled' as const,
		insertText: alias.insertText,
	})),
]

/**
 * Session labels derived from RPI skills, deduplicated since multiple skills can
 * share the same label.
 *
 * The array index encodes progression rank (ascending = more progressed), so the
 * order here is load-bearing: both the sidebar (`getMostProgressedLabel`) and the
 * task table (`useTaskMostProgressedLabel`) pick the "furthest along" label by
 * `RPI_LABELS.findIndex(name)`. The order is the order each label first appears in
 * RPI_SKILLS (which is maintained in progression order), with `rpi:todo` prepended
 * so it ranks lowest since it has no corresponding skill.
 * Locked in by the rank-contract test in `rpi-skills.test.ts`.
 */
export const RPI_LABELS: SessionLabel[] = RPI_SKILLS.reduce(
	(acc, skill) => {
		if (!acc.some((label) => label.name === skill.label.name)) {
			acc.push(skill.label)
		}
		return acc
	},
	[{ name: 'rpi:todo', title: 'todo' }] as SessionLabel[],
)

/**
 * Button labels for next step prompts, keyed by skill ID
 */
export const NEXT_STEP_BUTTON_LABELS: Record<string, string> = Object.fromEntries(
	RPI_SKILLS.map((skill) => [skill.skillId, skill.buttonText]),
)

/**
 * Map from phase label name (e.g. 'rpi:plan') to the "create" slash command for that phase.
 * Used when clicking unstarted phase placeholders in the workflow graph.
 */
export const PHASE_LABEL_TO_SLASH_COMMAND: Record<string, string> = Object.fromEntries(
	RPI_LABELS.filter((l) => l.name !== 'rpi:todo')
		.map((label) => {
			const skill = RPI_SKILLS.find((s) => s.label.name === label.name)
			return skill ? [label.name, `/${skill.name}`] : null
		})
		.filter(Boolean) as [string, string][],
)

/**
 * Map from phase label name (e.g. 'rpi:plan') to the "iterate" slash command for that phase.
 * Used by the "Continue in New Session" button to navigate to the draft launcher with the iterate skill.
 */
export const PHASE_LABEL_TO_ITERATE_SLASH_COMMAND: Record<string, string> = Object.fromEntries(
	RPI_LABELS.filter((l) => l.name !== 'rpi:todo')
		.map((label) => {
			const skill = RPI_SKILLS.find((s) => s.label.name === label.name && s.skillId.startsWith('iterate-'))
			return skill ? [label.name, `/${skill.name}`] : null
		})
		.filter(Boolean) as [string, string][],
)

/**
 * Map from skill ID (e.g. 'create-plan') to slash command (e.g. '/rpi:create-plan').
 * Used by next step buttons to derive the slash command from nextStepType.
 */
export const SKILL_ID_TO_SLASH_COMMAND: Record<string, string> = Object.fromEntries(
	RPI_SKILLS.map((skill) => [skill.skillId, `/${skill.name}`]),
)

/**
 * Lookup map from full skill name (e.g. "rpi:create-research") to RpiSkill
 * Used by ConversationEventRow to resolve skill color at render time
 */
export const RPI_SKILL_BY_NAME = new Map<string, RpiSkill>(RPI_SKILLS.map((s) => [s.name, s]))

/**
 * Maps RPI session label names to their corresponding auto-advance flag column names
 * on the tasks table. Used by notification suppression and button state logic.
 * Labels not in this map (e.g. 'rpi:design', 'rpi:structure') have no auto-advance toggle.
 */
export const LABEL_TO_AUTO_ADVANCE_FIELD = {
	'rpi:research-questions': 'auto_advance_questions_to_research',
	'rpi:research': 'auto_advance_research_to_design',
	'rpi:plan': 'auto_advance_plan_to_worktree',
	'rpi:worktree-setup': 'auto_advance_worktree_to_implementation',
	'rpi:implementation': 'auto_advance_implementation_to_pr',
} as const
