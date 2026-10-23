// apps/wui/src/lib/build-config.ts
import { Option, Schema } from 'effect'

import { logger } from '@/lib/logger'

import { BUILD_TYPES, BuildType } from './build-types'

logger.info(
	'BUILD TYPE:',
	import.meta.env.VITE_PUBLIC_BUILD_TYPE ?? '(Falling back to local due to missing VITE_PUBLIC_BUILD_TYPE',
)

const SENTRY_ENVIRONMENTS = ['prod', 'beta', 'devcloud', 'local'] as const
const SentryEnvironment = Schema.Literals(SENTRY_ENVIRONMENTS)

const configuredBuildType = import.meta.env.VITE_PUBLIC_BUILD_TYPE || 'local'
const buildType = Option.getOrUndefined(Schema.decodeUnknownOption(BuildType)(configuredBuildType)) ?? 'local'
const sentryEnvironment =
	Option.getOrUndefined(
		Schema.decodeUnknownOption(SentryEnvironment)(import.meta.env.VITE_PUBLIC_SENTRY_ENVIRONMENT || 'local'),
	) ?? 'local'

const CHANNEL_NAMES: Record<(typeof BUILD_TYPES)[number], string> = {
	local: 'Local',
	dev: 'Dev',
	beta: 'Beta',
	prod: 'Prod',
}

export const buildConfig = {
	// Get the build type, defaulting to 'local' if not set
	type: buildType,

	version: import.meta.env.VITE_PUBLIC_BUILD_VERSION ?? 'dev',

	daemonVersion: import.meta.env.VITE_PUBLIC_DAEMON_VERSION ?? 'dev',

	// Sentry environment: set by build scripts or CI
	sentryEnvironment,

	// Channel name for display
	channelName: CHANNEL_NAMES[buildType],

	billingEnforcementEnabled: import.meta.env.VITE_PUBLIC_BILLING_ENFORCEMENT_ENABLED === 'true',

	devstackId: import.meta.env.VITE_PUBLIC_DEVSTACK_ID || null,
}

export function buildDisplayLabel(
	config: Pick<typeof buildConfig, 'channelName' | 'devstackId'> = buildConfig,
): string {
	return config.devstackId ? `devstk-${config.devstackId}` : config.channelName
}
