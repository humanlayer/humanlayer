import z from 'zod/v4'

// Forgiving destination: SDK enum is 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg',
// but accept any string to keep legacy rows parseable.
const DestinationSchema = z.string().optional()

const PermissionRuleValueSchema = z.object({
	toolName: z.string(),
	ruleContent: z.string().optional(),
})

export const PermissionUpdateSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('addRules'),
		rules: z.array(PermissionRuleValueSchema),
		behavior: z.string(),
		destination: DestinationSchema,
	}),
	z.object({
		type: z.literal('setMode'),
		mode: z.string(),
		destination: DestinationSchema,
	}),
	z.object({
		type: z.literal('addDirectories'),
		directories: z.array(z.string()),
		destination: DestinationSchema,
	}),
])

export type PermissionUpdate = z.infer<typeof PermissionUpdateSchema>

/**
 * Called for any input we couldn't surface as a valid `PermissionUpdate[]`.
 * Lives here (not in db package) — callers wire their own logger/Sentry to keep
 * @humanlayer/db isomorphic.
 */
export type ParseSuggestionsOnDropped = (info: {
	reason: 'invalidJson' | 'notArray' | 'invalidEntry'
	entry: unknown
	error?: unknown
}) => void

export function parseSuggestions(
	value: unknown,
	onDropped?: ParseSuggestionsOnDropped,
): PermissionUpdate[] | undefined {
	if (value === undefined || value === null) return undefined

	let raw: unknown = value
	if (typeof raw === 'string') {
		try {
			raw = JSON.parse(raw)
		} catch (error) {
			onDropped?.({ reason: 'invalidJson', entry: value, error })
			return undefined
		}
	}

	if (!Array.isArray(raw)) {
		onDropped?.({ reason: 'notArray', entry: raw })
		return undefined
	}

	const parsed: PermissionUpdate[] = []
	for (const entry of raw) {
		const result = PermissionUpdateSchema.safeParse(entry)
		if (result.success) {
			parsed.push(result.data)
		} else {
			onDropped?.({ reason: 'invalidEntry', entry, error: result.error })
		}
	}

	return parsed.length > 0 ? parsed : undefined
}
