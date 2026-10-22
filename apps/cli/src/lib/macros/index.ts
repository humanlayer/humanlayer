import {
	BetaApiOriginMacro,
	BetaAppOriginMacro,
	BetaCloudOriginMacro,
	BetaSyncOriginMacro,
	BetaWorkosClientIdMacro,
	BuildVersionMacro,
	DevApiOriginMacro,
	DevAppOriginMacro,
	DevCloudOriginMacro,
	DevSyncOriginMacro,
	DevWorkosClientIdMacro,
	LocalWorkosClientIdMacro,
	ProdApiOriginMacro,
	ProdAppOriginMacro,
	ProdCloudOriginMacro,
	ProdSyncOriginMacro,
	ProdWorkosClientIdMacro,
} from './_macros-do-not-import' with { type: 'macro' }

export const BUILD_VERSION = BuildVersionMacro()

export interface EnvironmentConfig {
	workosClientId: string
	apiOrigin: string
	syncOrigin: string
	/** Origin of the riptide-cloud web app that serves artifact and task permalinks. */
	cloudOrigin: string
	/** Origin of riptide-ui, where session deep links (`<app>/sessions/<id>`) resolve. */
	appOrigin: string
}

export type EnvironmentName = 'prod' | 'beta' | 'dev' | 'local'

// Local environment uses localhost services but still authenticates users with
// the dev WorkOS public client for user-auth CLI flows.
const LOCAL_CONFIG: EnvironmentConfig = {
	workosClientId: LocalWorkosClientIdMacro() ?? '',
	apiOrigin: 'http://localhost:8700',
	syncOrigin: 'http://localhost:8888',
	cloudOrigin: 'http://localhost:5174',
	appOrigin: 'http://localhost:3000',
}

const DEV_WORKOS_CLIENT_ID = DevWorkosClientIdMacro()
const DEV_CONFIG: EnvironmentConfig | undefined = DEV_WORKOS_CLIENT_ID
	? {
			workosClientId: DEV_WORKOS_CLIENT_ID,
			apiOrigin: DevApiOriginMacro() ?? 'http://localhost:8700',
			syncOrigin: DevSyncOriginMacro() ?? 'http://localhost:8888',
			cloudOrigin: DevCloudOriginMacro() ?? 'http://localhost:5174',
			appOrigin: DevAppOriginMacro() ?? 'http://localhost:3000',
		}
	: undefined

const BETA_WORKOS_CLIENT_ID = BetaWorkosClientIdMacro()
const BETA_API_ORIGIN = BetaApiOriginMacro()
const BETA_SYNC_ORIGIN = BetaSyncOriginMacro()
const BETA_CLOUD_ORIGIN = BetaCloudOriginMacro()
const BETA_APP_ORIGIN = BetaAppOriginMacro()
const BETA_CONFIG: EnvironmentConfig | undefined =
	BETA_WORKOS_CLIENT_ID && BETA_API_ORIGIN && BETA_SYNC_ORIGIN && BETA_CLOUD_ORIGIN && BETA_APP_ORIGIN
		? {
				workosClientId: BETA_WORKOS_CLIENT_ID,
				apiOrigin: BETA_API_ORIGIN,
				syncOrigin: BETA_SYNC_ORIGIN,
				cloudOrigin: BETA_CLOUD_ORIGIN,
				appOrigin: BETA_APP_ORIGIN,
			}
		: undefined

const PROD_WORKOS_CLIENT_ID = ProdWorkosClientIdMacro()
const PROD_API_ORIGIN = ProdApiOriginMacro()
const PROD_SYNC_ORIGIN = ProdSyncOriginMacro()
const PROD_CLOUD_ORIGIN = ProdCloudOriginMacro()
const PROD_APP_ORIGIN = ProdAppOriginMacro()
const PROD_CONFIG: EnvironmentConfig | undefined =
	PROD_WORKOS_CLIENT_ID && PROD_API_ORIGIN && PROD_SYNC_ORIGIN && PROD_CLOUD_ORIGIN && PROD_APP_ORIGIN
		? {
				workosClientId: PROD_WORKOS_CLIENT_ID,
				apiOrigin: PROD_API_ORIGIN,
				syncOrigin: PROD_SYNC_ORIGIN,
				cloudOrigin: PROD_CLOUD_ORIGIN,
				appOrigin: PROD_APP_ORIGIN,
			}
		: undefined

const ENV_CONFIGS: Record<EnvironmentName, EnvironmentConfig | undefined> = {
	local: LOCAL_CONFIG,
	dev: DEV_CONFIG,
	beta: BETA_CONFIG,
	prod: PROD_CONFIG,
}

/**
 * Like {@link resolveEnvironmentConfig}, but returns undefined instead of EXITING when the env is
 * not baked into this build.
 */
export function resolveEnvironmentConfigOrNull(env: EnvironmentName): EnvironmentConfig | undefined {
	const base = ENV_CONFIGS[env]
	if (!base) return undefined

	// Local development can target an alternate stack. Named cloud environments must use their
	// baked configuration so a stale shell variable cannot mix a beta API with production links.
	if (env !== 'local') return base

	return {
		workosClientId: base.workosClientId,
		apiOrigin: process.env.RIPTIDE_API_ORIGIN ?? base.apiOrigin,
		syncOrigin: process.env.RIPTIDE_SYNC_ORIGIN ?? base.syncOrigin,
		cloudOrigin: process.env.RIPTIDE_CLOUD_ORIGIN ?? base.cloudOrigin,
		appOrigin: process.env.RIPTIDE_APP_ORIGIN || base.appOrigin,
	}
}

/**
 * Resolve the environment config for the given environment name. Runtime endpoint overrides apply
 * only to the local environment; beta and production always use their baked-in values.
 */
export function resolveEnvironmentConfig(env: EnvironmentName): EnvironmentConfig {
	const config = resolveEnvironmentConfigOrNull(env)

	if (!config) {
		if (env === 'prod') {
			console.error('The prod environment is not yet available.')
			console.error('Use --beta to connect to the beta environment.')
		} else {
			console.error(`The ${env} environment is not configured in this build.`)
		}
		process.exit(1)
	}

	return config
}
