import { Config, Effect, Option } from 'effect'

import {
	ONBOARDING_SEQUENCE_FULL,
	ONBOARDING_SEQUENCE_LITE,
	ONBOARDING_SEQUENCE_WELCOME_ONLY,
	type OnboardingSequence,
} from './onboarding-properties'

export type OnboardingConfigShape = {
	enabled: boolean
	welcomeOnlyPercent: number
	litePercent: number
	automationId?: string
	productUsersSegmentId: string
}

const validatePercent = (name: string, value: number) =>
	value < 0 || value > 100 ? Effect.fail(new Error(`${name} must be between 0 and 100`)) : Effect.succeed(value)

/**
 * Loads onboarding campaign config through Effect's `Config` API so the values
 * resolve from the active `ConfigProvider` (environment variables in
 * production, an injected provider in tests) instead of direct `process.env`
 * reads. Percentage bounds and their total are validated here so the live
 * onboarding layer fails fast at construction time when misconfigured.
 */
export const loadOnboardingConfigFromEffectConfig = Effect.gen(function* () {
	const enabled = yield* Config.Boolean('ONBOARDING_CAMPAIGN_ENABLED').pipe(Config.withDefault(false))
	// v1 production defaults: 10% welcome-only, 10% lite, full = computed remainder
	// (80%). See the TDD "Sequence assignment is random and weighted by env config".
	const welcomeOnlyPercent = yield* validatePercent(
		'ONBOARDING_WELCOME_ONLY_PERCENT',
		yield* Config.Number('ONBOARDING_WELCOME_ONLY_PERCENT').pipe(Config.withDefault(10)),
	)
	const litePercent = yield* validatePercent(
		'ONBOARDING_LITE_PERCENT',
		yield* Config.Number('ONBOARDING_LITE_PERCENT').pipe(Config.withDefault(10)),
	)
	const automationId = Option.getOrUndefined(yield* Config.option(Config.String('ONBOARDING_AUTOMATION_ID')))
	const productUsersSegmentId = yield* Config.String('RESEND_PRODUCT_USERS_SEGMENT_ID')

	if (welcomeOnlyPercent + litePercent > 100) {
		return yield* Effect.fail(new Error('ONBOARDING_WELCOME_ONLY_PERCENT + ONBOARDING_LITE_PERCENT must be <= 100'))
	}

	return {
		enabled,
		welcomeOnlyPercent,
		litePercent,
		automationId,
		productUsersSegmentId,
	} satisfies OnboardingConfigShape
})

/**
 * Full is the computed remainder: `100 - welcomeOnly - lite`. Validation in
 * `loadOnboardingConfigFromEffectConfig` guarantees the two stored percentages
 * sum to <= 100, so this is always non-negative.
 */
export function fullSequencePercent(config: Pick<OnboardingConfigShape, 'welcomeOnlyPercent' | 'litePercent'>): number {
	return 100 - config.welcomeOnlyPercent - config.litePercent
}

export function assignOnboardingSequence(
	config: Pick<OnboardingConfigShape, 'welcomeOnlyPercent' | 'litePercent'>,
): OnboardingSequence {
	const roll = Math.random() * 100
	if (roll < config.welcomeOnlyPercent) return ONBOARDING_SEQUENCE_WELCOME_ONLY
	if (roll < config.welcomeOnlyPercent + config.litePercent) return ONBOARDING_SEQUENCE_LITE
	return ONBOARDING_SEQUENCE_FULL
}
