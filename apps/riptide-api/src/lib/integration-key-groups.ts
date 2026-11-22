/**
 * The environment keys each optional integration needs. An integration is set up only when every
 * key in its group is set to a non-empty value. Missing any key means the integration is not set
 * up, and startup says which keys are missing instead of stopping the API.
 *
 * Stripe is the exception: when billing enforcement is on, its keys stay required (see
 * `StripeServiceForDeploymentLive`).
 */
export type IntegrationKeyGroup<Key extends string = string> = {
	readonly name: string
	readonly keys: readonly [Key, ...Key[]]
	/** Named in the "no keys are set" line. Defaults to the first word of the first key: `SLACK_`. */
	readonly keyPrefix?: string
}

export const SlackKeyGroup = {
	name: 'Slack',
	keys: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_APP_ID', 'SLACK_SIGNING_SECRET'],
} as const satisfies IntegrationKeyGroup

export const GitHubKeyGroup = {
	name: 'GitHub',
	keyPrefix: 'GITHUB_APP_',
	keys: [
		'GITHUB_APP_ID',
		'GITHUB_APP_CLIENT_ID',
		'GITHUB_APP_SLUG',
		'GITHUB_APP_PRIVATE_KEY',
		'GITHUB_APP_WEBHOOK_SECRET',
	],
} as const satisfies IntegrationKeyGroup

/** `RESEND_WEBHOOK_SECRET` is not part of this group; it only decides whether the webhook route exists. */
export const EmailKeyGroup = {
	name: 'Email',
	keys: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_PRODUCT_USERS_SEGMENT_ID'],
} as const satisfies IntegrationKeyGroup

export const JiraKeyGroup = {
	name: 'Jira',
	keys: ['JIRA_CLIENT_ID', 'JIRA_CLIENT_SECRET'],
} as const satisfies IntegrationKeyGroup

export const LinearKeyGroup = {
	name: 'Linear',
	keys: ['LINEAR_CLIENT_ID', 'LINEAR_CLIENT_SECRET'],
} as const satisfies IntegrationKeyGroup

export const StripeKeyGroup = {
	name: 'Stripe',
	keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_STARTER'],
} as const satisfies IntegrationKeyGroup

export type IntegrationKeyGroupStatus<Key extends string = string> =
	| { readonly configured: true }
	| {
			readonly configured: false
			readonly missingKeys: readonly Key[]
			/** True when some keys are set and others are missing: a likely typo or partial setup. */
			readonly partiallySet: boolean
	  }

/** A key counts as set only when it has a value other than whitespace. */
export const isEnvironmentValueSet = (value: string | undefined): value is string =>
	value !== undefined && value.trim() !== ''

/** Applies the all-or-nothing rule to one group, given which keys are set. */
export function classifyIntegrationKeyGroup<Key extends string>(
	group: IntegrationKeyGroup<Key>,
	isKeySet: (key: Key) => boolean,
): IntegrationKeyGroupStatus<Key> {
	const missingKeys = group.keys.filter((key) => !isKeySet(key))
	if (missingKeys.length === 0) return { configured: true }
	return { configured: false, missingKeys, partiallySet: missingKeys.length < group.keys.length }
}

/** The group's own prefix, or the first word of its first key: `SLACK_CLIENT_ID` gives `SLACK_`. */
function keyGroupPrefix(group: IntegrationKeyGroup): string {
	if (group.keyPrefix) return group.keyPrefix
	const firstUnderscore = group.keys[0].indexOf('_')
	return firstUnderscore === -1 ? '' : group.keys[0].slice(0, firstUnderscore + 1)
}

/**
 * The startup line for a group that is not set up:
 * - none set: `Slack is not set up: no SLACK_* keys are set`
 * - some set: `Slack is not set up: missing SLACK_APP_ID, SLACK_SIGNING_SECRET`
 */
export function describeUnconfiguredIntegrationKeyGroup<Key extends string>(
	group: IntegrationKeyGroup<Key>,
	status: Extract<IntegrationKeyGroupStatus<Key>, { configured: false }>,
): string {
	if (status.partiallySet) return `${group.name} is not set up: missing ${status.missingKeys.join(', ')}`
	const prefix = keyGroupPrefix(group)
	return prefix
		? `${group.name} is not set up: no ${prefix}* keys are set`
		: `${group.name} is not set up: none of ${group.keys.join(', ')} are set`
}
