import { LABEL_TO_AUTO_ADVANCE_FIELD } from '@humanlayer/ui/constants/rpi-skills'
import { Option, Schema } from 'effect'

const AUTO_ADVANCE_SOURCE_LABELS = [
	'rpi:research-questions',
	'rpi:research',
	'rpi:design',
	'rpi:design-prd',
	'rpi:design-tdd',
	'rpi:structure',
	'rpi:plan',
	'rpi:worktree-setup',
	'rpi:implementation',
] as const
const AutoAdvanceSourceLabel = Schema.Literals(AUTO_ADVANCE_SOURCE_LABELS)
type AutoAdvanceSourceLabel = typeof AutoAdvanceSourceLabel.Type
const AutoAdvanceSessionLabel = Schema.Struct({ name: AutoAdvanceSourceLabel })

type AutoAdvanceField = (typeof LABEL_TO_AUTO_ADVANCE_FIELD)[keyof typeof LABEL_TO_AUTO_ADVANCE_FIELD]

type AutoAdvanceTransition = {
	field: AutoAdvanceField | null
	nextStepName: string
	targetLabel: string
}

export const AUTO_ADVANCE_TRANSITIONS: Record<AutoAdvanceSourceLabel, AutoAdvanceTransition> = {
	'rpi:research-questions': {
		field: LABEL_TO_AUTO_ADVANCE_FIELD['rpi:research-questions'],
		nextStepName: 'research',
		targetLabel: 'rpi:research',
	},
	'rpi:research': {
		field: LABEL_TO_AUTO_ADVANCE_FIELD['rpi:research'],
		nextStepName: 'design',
		targetLabel: 'rpi:design',
	},
	'rpi:design': { field: null, nextStepName: 'structure outline', targetLabel: 'rpi:structure' },
	'rpi:design-prd': { field: null, nextStepName: 'TDD', targetLabel: 'rpi:design-tdd' },
	'rpi:design-tdd': { field: null, nextStepName: 'structure outline', targetLabel: 'rpi:structure' },
	'rpi:structure': { field: null, nextStepName: 'plan', targetLabel: 'rpi:plan' },
	'rpi:plan': {
		field: LABEL_TO_AUTO_ADVANCE_FIELD['rpi:plan'],
		nextStepName: 'worktree setup',
		targetLabel: 'rpi:worktree-setup',
	},
	'rpi:worktree-setup': {
		field: LABEL_TO_AUTO_ADVANCE_FIELD['rpi:worktree-setup'],
		nextStepName: 'implementation',
		targetLabel: 'rpi:implementation',
	},
	'rpi:implementation': {
		field: LABEL_TO_AUTO_ADVANCE_FIELD['rpi:implementation'],
		nextStepName: 'PR description',
		targetLabel: 'rpi:describe-pr',
	},
}

export const AUTO_ADVANCE_FIELD_TO_SETTINGS_KEY = {
	auto_advance_questions_to_research: 'autoAdvanceQuestionsToResearch',
	auto_advance_research_to_design: 'autoAdvanceResearchToDesign',
	auto_advance_plan_to_worktree: 'autoAdvancePlanToWorktree',
	auto_advance_worktree_to_implementation: 'autoAdvanceWorktreeToImplementation',
	auto_advance_implementation_to_pr: 'autoAdvanceImplementationToPr',
} as const

export function findAutoAdvanceSourceLabel(labels: unknown): AutoAdvanceSourceLabel | undefined {
	if (!Array.isArray(labels)) return undefined
	for (const label of labels) {
		const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(AutoAdvanceSessionLabel)(label))
		if (parsed) return parsed.name
	}
	return undefined
}

export function findAutoAdvanceField(labels: unknown): AutoAdvanceField | null {
	if (!Array.isArray(labels)) return null
	for (const label of labels) {
		const parsed = Option.getOrUndefined(Schema.decodeUnknownOption(AutoAdvanceSessionLabel)(label))
		if (!parsed) continue
		const field = AUTO_ADVANCE_TRANSITIONS[parsed.name].field
		if (field !== null) return field
	}
	return null
}
