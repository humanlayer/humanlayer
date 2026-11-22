import { Config, Effect, Option } from 'effect'

import { parseBillingEnforcementFlag } from '../../../lib/environment'
import {
	classifyIntegrationKeyGroup,
	describeUnconfiguredIntegrationKeyGroup,
	type IntegrationKeyGroup,
	type IntegrationKeyGroupStatus,
	isEnvironmentValueSet,
} from '../../../lib/integration-key-groups'

/**
 * Reads which keys of an integration's group are set, through the active `ConfigProvider`. Only
 * presence leaves this function: the values stay with the service that reads them as
 * `Config.String` / `Config.Redacted` once it knows the group is complete.
 */
export const readIntegrationKeyGroupStatus = <Key extends string>(
	group: IntegrationKeyGroup<Key>,
): Effect.Effect<IntegrationKeyGroupStatus<Key>, Config.ConfigError> =>
	Effect.gen(function* () {
		const setKeys = new Set<Key>()
		for (const key of group.keys) {
			const value = yield* Config.option(Config.String(key))
			if (isEnvironmentValueSet(Option.getOrUndefined(value))) setKeys.add(key)
		}
		return classifyIntegrationKeyGroup(group, (key) => setKeys.has(key))
	})

/** Logs why an integration is not set up: `info` when no key is set, `warning` when some are. */
export const reportIntegrationKeyGroupStatus = <Key extends string>(
	group: IntegrationKeyGroup<Key>,
	status: IntegrationKeyGroupStatus<Key>,
): Effect.Effect<void> => {
	if (status.configured) return Effect.void
	const message = describeUnconfiguredIntegrationKeyGroup(group, status)
	const log = status.partiallySet ? Effect.logWarning(message) : Effect.logInfo(message)
	return log.pipe(Effect.annotateLogs({ integration: group.name, missing_keys: status.missingKeys.join(',') }))
}

/**
 * Decides at layer construction whether an integration is set up, and says so in the startup log
 * when it is not. Each Effect service calls this once, before it reads its own keys.
 */
export const loadIntegrationKeyGroup = <Key extends string>(
	group: IntegrationKeyGroup<Key>,
): Effect.Effect<boolean, Config.ConfigError> =>
	readIntegrationKeyGroupStatus(group).pipe(
		Effect.tap((status) => reportIntegrationKeyGroupStatus(group, status)),
		Effect.map((status) => status.configured),
		Effect.withSpan('integration_configuration.load_key_group', { attributes: { integration: group.name } }),
	)

/**
 * `IS_BILLING_ENFORCEMENT_ENABLED`, read through Config. Unset means off; only the exact string
 * `true` turns enforcement on.
 */
export const BillingEnforcementEnabledConfig: Config.Config<boolean> = Config.option(
	Config.String('IS_BILLING_ENFORCEMENT_ENABLED'),
).pipe(Config.map((value) => parseBillingEnforcementFlag(Option.getOrUndefined(value))))
