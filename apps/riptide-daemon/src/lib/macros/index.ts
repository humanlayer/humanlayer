import {
	ApiOriginMacro,
	AppOriginMacro,
	BuildTypeMacro,
	BuildVersionMacro,
	CloudOriginMacro,
	CommitHashMacro,
	LogBaseMacro,
	LogLevelMacro,
	NodeEnvMacro,
	SentryDsnMacro,
	SentryEnvironmentMacro,
	SyncOriginMacro,
} from './_macros-do-not-import' with { type: 'macro' }

export const BUILD_TYPE = BuildTypeMacro()
export const BUILD_VERSION = BuildVersionMacro()
export const COMMIT_HASH = CommitHashMacro()
export const LOG_LEVEL = LogLevelMacro()
export const LOG_BASE = LogBaseMacro()

export const BUILD_NODE_ENV = NodeEnvMacro()
export const SENTRY_ENVIRONMENT = SentryEnvironmentMacro()
export const SENTRY_DSN = SentryDsnMacro() || undefined

export const API_ORIGIN = process.env.RIPTIDE_API_ORIGIN ?? ApiOriginMacro()

export const SYNC_ORIGIN = process.env.RIPTIDE_SYNC_ORIGIN ?? SyncOriginMacro()

// The standalone daemon uses its build-time origin. The shared CLI overrides this before loading
// the embedded daemon so `humanlayer --beta daemon launch` produces beta artifact links.
export const CLOUD_ORIGIN = process.env.RIPTIDE_CLOUD_ORIGIN || CloudOriginMacro()

/**
 * riptide-ui's origin, where session deep links (`<app>/sessions/<id>`) resolve. An empty override
 * counts as unset — `RIPTIDE_APP_ORIGIN=` in a shell rc must not blank out the baked value.
 */
export const APP_ORIGIN = process.env.RIPTIDE_APP_ORIGIN || AppOriginMacro()
