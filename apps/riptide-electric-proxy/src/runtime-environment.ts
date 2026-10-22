export type ProxyRuntimeEnvironment = {
	electricShapeUrl: string
	electricSecret?: string
	durableStreamsOrigin: string
}

export function resolveProxyRuntimeEnvironment(env: NodeJS.ProcessEnv): ProxyRuntimeEnvironment {
	const electricShapeUrl = env.ELECTRIC_SHAPE_URL
	if (!electricShapeUrl) throw new Error('ELECTRIC_SHAPE_URL is required')
	const durableStreamsOrigin = env.DURABLE_STREAMS_ORIGIN
	if (!durableStreamsOrigin) throw new Error('DURABLE_STREAMS_ORIGIN is required')
	return {
		electricShapeUrl,
		electricSecret: env.ELECTRIC_SECRET,
		durableStreamsOrigin,
	}
}
