import { Context, Layer } from 'effect'

export type ProxyRuntimeConfigValues = {
	readonly electricShapeUrl: string
	readonly electricOrigin: string
	/** Request URL prefix, without a trailing slash. May include a path. */
	readonly durableStreamsBaseUrl: string
	/** Scheme and authority only, for Undici pools and origin-keyed metrics. */
	readonly durableStreamsOrigin: string
}

export class ProxyRuntimeConfig extends Context.Service<ProxyRuntimeConfig, ProxyRuntimeConfigValues>()(
	'ProxyRuntimeConfig',
) {}

export const makeProxyRuntimeConfig = (values: {
	readonly electricShapeUrl: string
	readonly durableStreamsOrigin: string
}) => {
	const electricShapeUrl = values.electricShapeUrl
	const durableStreamsUrl = new URL(values.durableStreamsOrigin)
	return {
		electricShapeUrl,
		electricOrigin: new URL(electricShapeUrl).origin,
		durableStreamsBaseUrl: durableStreamsUrl.href.replace(/\/+$/, ''),
		durableStreamsOrigin: durableStreamsUrl.origin,
	} satisfies ProxyRuntimeConfigValues
}

export const ProxyRuntimeConfigLive = (values: ProxyRuntimeConfigValues) => Layer.succeed(ProxyRuntimeConfig, values)
