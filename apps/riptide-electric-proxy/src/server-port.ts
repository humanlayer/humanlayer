export function resolveElectricProxyPort(
	env: Partial<Pick<NodeJS.ProcessEnv, 'RIPTIDE_ELECTRIC_PROXY_PORT' | 'PORT'>>,
): number {
	return Number(env.RIPTIDE_ELECTRIC_PROXY_PORT ?? env.PORT) || 8888
}
