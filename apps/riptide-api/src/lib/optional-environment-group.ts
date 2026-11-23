import { logger as defaultLogger } from '../logger'
import {
	classifyIntegrationKeyGroup,
	describeUnconfiguredIntegrationKeyGroup,
	type IntegrationKeyGroup,
	isEnvironmentValueSet,
} from './integration-key-groups'

type OptionalEnvironmentGroupLogger = Pick<typeof defaultLogger, 'info' | 'warn'>

/**
 * Reads a group of environment variables for a class-based integration (Jira, Linear, the classic
 * Stripe service). Returns every value when all keys are set, or `null` when any is missing, and
 * logs which keys are missing: `info` when none are set, `warn` when only some are.
 *
 * The Effect services apply the same rule through `loadIntegrationKeyGroup`.
 */
export function optionalEnvironmentGroup<Key extends string>(
	name: string,
	keys: readonly [Key, ...Key[]],
	options: {
		readonly environment?: Readonly<Record<string, string | undefined>>
		readonly logger?: OptionalEnvironmentGroupLogger
	} = {},
): Readonly<Record<Key, string>> | null {
	const environment = options.environment ?? process.env
	const logger = options.logger ?? defaultLogger
	const group: IntegrationKeyGroup<Key> = { name, keys }
	const values = new Map<Key, string>()
	for (const key of keys) {
		const value = environment[key]
		if (isEnvironmentValueSet(value)) values.set(key, value)
	}
	const status = classifyIntegrationKeyGroup(group, (key) => values.has(key))
	if (!status.configured) {
		const message = describeUnconfiguredIntegrationKeyGroup(group, status)
		const fields = { integration: name, missingKeys: status.missingKeys }
		if (status.partiallySet) logger.warn(fields, message)
		else logger.info(fields, message)
		return null
	}
	// Every key in the group is in `values`: the classification above found none missing.
	return Object.fromEntries(values) as Readonly<Record<Key, string>>
}
