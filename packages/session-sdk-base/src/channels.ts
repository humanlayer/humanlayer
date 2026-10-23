// The HumanLayer clouds a session-side client can talk to, and their origins.
//
// Only `local` has origins in source. The rest come from HUMANLAYER_CHANNELS, a JSON object
// each plugin build bakes into its bundle (see channelsDefine), so a build from source reaches
// no cloud. HUMANLAYER_API_URL, _SYNC_URL, _APP_URL, _WORKOS_URL and _WORKOS_CLIENT_ID override
// any channel at runtime, which is how a self-hosted cloud is reached.

export type Channel = 'prod' | 'beta' | 'dev' | 'local'

export const ALL_CHANNELS: readonly Channel[] = ['prod', 'beta', 'dev', 'local']

export function isChannel(value: string | undefined): value is Channel {
	return value !== undefined && (ALL_CHANNELS as readonly string[]).includes(value)
}

interface ChannelDefaults {
	api?: string
	sync?: string
	app?: string
	/** The WorkOS client id for device login. */
	clientId?: string
}

export type BuiltChannels = Partial<Record<Channel, ChannelDefaults>>

const SOURCE_DEFAULTS: BuiltChannels = {
	local: {
		api: 'http://localhost:8700',
		sync: 'http://localhost:8888',
		app: 'http://localhost:3000',
	},
}

/** Parses a HUMANLAYER_CHANNELS value; empty or unset means no built-in channels. */
export function parseChannels(raw: string | undefined): BuiltChannels {
	if (!raw) return {}
	const parsed: unknown = JSON.parse(raw)
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error('HUMANLAYER_CHANNELS must be a JSON object keyed by channel')
	}
	for (const key of Object.keys(parsed)) {
		if (!isChannel(key)) throw new Error(`HUMANLAYER_CHANNELS has unknown channel "${key}"`)
	}
	return parsed as BuiltChannels
}

/**
 * The Bun.build `define` that bakes the build's HUMANLAYER_CHANNELS into a bundle, so the bundle
 * never reads it from the user's shell. Validates it first.
 */
export function channelsDefine(raw: string | undefined = process.env.HUMANLAYER_CHANNELS) {
	parseChannels(raw)
	return { 'process.env.HUMANLAYER_CHANNELS': JSON.stringify(raw ?? '') }
}

const BUILT_CHANNELS = parseChannels(process.env.HUMANLAYER_CHANNELS)

const DEFAULT_WORKOS_URL = 'https://api.workos.com'

export interface ChannelConfig {
	channel: Channel
	api: string
	sync: string
	app: string
	workos: string
	/** Undefined when the build has none; only device login needs it (see requireClientId). */
	clientId: string | undefined
}

/**
 * A channel's origins and client id: env overrides first, then the build's HUMANLAYER_CHANNELS,
 * then the source defaults. Throws when an origin is missing, naming what to set.
 */
export function getChannelConfig(
	channel: Channel,
	env: Record<string, string | undefined> = process.env,
	built: BuiltChannels = BUILT_CHANNELS,
): ChannelConfig {
	const base = { ...SOURCE_DEFAULTS[channel], ...built[channel] }
	const api = env.HUMANLAYER_API_URL || base.api
	const sync = env.HUMANLAYER_SYNC_URL || base.sync
	const app = env.HUMANLAYER_APP_URL || base.app
	if (!api || !sync || !app) {
		const missing = [
			api ? undefined : 'HUMANLAYER_API_URL',
			sync ? undefined : 'HUMANLAYER_SYNC_URL',
			app ? undefined : 'HUMANLAYER_APP_URL',
		].filter((name) => name !== undefined)
		throw new Error(`The ${channel} channel isn't configured in this build. Set ${missing.join(', ')}.`)
	}
	return {
		channel,
		api,
		sync,
		app,
		workos: env.HUMANLAYER_WORKOS_URL || DEFAULT_WORKOS_URL,
		clientId: env.HUMANLAYER_WORKOS_CLIENT_ID || base.clientId,
	}
}

/** The WorkOS client id device login needs; throws, naming what to set, when there is none. */
export function requireClientId(config: ChannelConfig): string {
	if (!config.clientId) {
		throw new Error(
			`The ${config.channel} channel has no WorkOS client id in this build. Set HUMANLAYER_WORKOS_CLIENT_ID.`,
		)
	}
	return config.clientId
}
