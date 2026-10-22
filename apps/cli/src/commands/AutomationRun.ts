import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import * as SchemaIssue from 'effect/SchemaIssue'
import * as SchemaTransformation from 'effect/SchemaTransformation'

const REQUIRED_OPTION_MESSAGE = 'Expected a non-empty command option'
const DURATION_MESSAGE = 'Expected a positive duration such as 30s, 2m, or 1h'

function durationMultiplier(unit: string): number {
	if (unit === 'ms') return 1
	if (unit === 's') return 1_000
	if (unit === 'm') return 60_000
	return 3_600_000
}

const RequiredOption = Schema.String.check(Schema.isPattern(/\S/, { error: { message: REQUIRED_OPTION_MESSAGE } }))

export const AutomationPromptText = Schema.String.check(
	Schema.isMinLength(1, { error: { message: 'Expected a non-empty initial prompt' } }),
)
export type AutomationPromptText = typeof AutomationPromptText.Type

const PositiveSafeInteger = Schema.Number.check(
	Schema.isInt({ error: { message: DURATION_MESSAGE } }),
	Schema.isGreaterThan(0, { error: { message: DURATION_MESSAGE } }),
	Schema.makeFilter((value) => Number.isSafeInteger(value), { error: { message: DURATION_MESSAGE } }),
)

export const AutomationInactivityMilliseconds = Schema.String.pipe(
	Schema.decodeTo(
		PositiveSafeInteger,
		SchemaTransformation.transformEffect({
			decode: (value, options) => {
				const match = /^(\d+)(ms|s|m|h)$/.exec(value.trim())
				const amountText = match?.[1]
				const unit = match?.[2]
				if (amountText === undefined || unit === undefined) {
					return Effect.fail(new SchemaIssue.InvalidValue({ message: DURATION_MESSAGE }, value, options))
				}

				const multiplier = durationMultiplier(unit)
				const milliseconds = Number(amountText) * multiplier
				return Number.isSafeInteger(milliseconds) && milliseconds > 0
					? Effect.succeed(milliseconds)
					: Effect.fail(new SchemaIssue.InvalidValue({ message: DURATION_MESSAGE }, value, options))
			},
			encode: (milliseconds) => Effect.succeed(`${milliseconds}ms`),
		}),
	),
)
export type AutomationInactivityMilliseconds = typeof AutomationInactivityMilliseconds.Type

const commonFields = {
	pat: RequiredOption,
	sessionName: RequiredOption,
	codingAgent: Schema.Literals(['claude', 'codelayer']),
	provider: Schema.Literals(['anthropic', 'openai', 'codex', 'copilot', 'firepass']),
	model: Schema.optionalKey(RequiredOption),
	thinking: Schema.optionalKey(Schema.Literals(['low', 'medium', 'high', 'xhigh', 'max'])),
	metadataFile: Schema.optionalKey(RequiredOption),
	shutdownOn: Schema.Literals(['inactivity', 'stop']),
	inactivity: AutomationInactivityMilliseconds,
	onFailure: Schema.Literals(['inactivity', 'stop']),
}

const EnsureTask = {
	ensureTask: RequiredOption,
	useTask: Schema.optional(Schema.Never),
	taskName: RequiredOption,
}

const UseTask = {
	ensureTask: Schema.optional(Schema.Never),
	useTask: RequiredOption,
	taskName: Schema.optional(Schema.Never),
}

const InlinePrompt = {
	prompt: AutomationPromptText,
	promptFile: Schema.optional(Schema.Never),
}

const PromptFile = {
	prompt: Schema.optional(Schema.Never),
	promptFile: RequiredOption,
}

export const AutomationRunOptions = Schema.Union(
	[
		Schema.Struct({ ...commonFields, ...EnsureTask, ...InlinePrompt }),
		Schema.Struct({ ...commonFields, ...EnsureTask, ...PromptFile }),
		Schema.Struct({ ...commonFields, ...UseTask, ...InlinePrompt }),
		Schema.Struct({ ...commonFields, ...UseTask, ...PromptFile }),
	],
	{ mode: 'oneOf' },
)
export type AutomationRunOptions = typeof AutomationRunOptions.Type

export type AutomationRunCliOptions = typeof AutomationRunOptions.Encoded

export const parseAutomationRunOptions = Schema.decodeUnknownSync(AutomationRunOptions)
export const parseAutomationInactivityMilliseconds = Schema.decodeUnknownSync(AutomationInactivityMilliseconds)
export const parseAutomationPromptText = Schema.decodeUnknownSync(AutomationPromptText)
