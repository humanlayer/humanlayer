export const ROUTE_NAMES = ['ui', 'cloud', 'api', 'sync', 'docs', 'adminApi', 'adminUi', 's3'] as const
export type StackRouteName = (typeof ROUTE_NAMES)[number]
export type StackRoutes = Record<StackRouteName, string>

const ROUTE_HOSTS: Record<StackRouteName, string> = {
	ui: 'app',
	cloud: 'cloud',
	api: 'api',
	sync: 'sync',
	docs: 'docs',
	adminApi: 'admin-api',
	adminUi: 'admin-ui',
	s3: 's3',
}

export function createStackRoutes(stackId: string): StackRoutes {
	return Object.fromEntries(
		ROUTE_NAMES.map((name) => [name, `https://${ROUTE_HOSTS[name]}.${stackId}.localhost`]),
	) as StackRoutes
}
