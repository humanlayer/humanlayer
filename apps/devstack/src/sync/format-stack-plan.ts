import type { Change, StackAction, StackPlan } from './stack-sync.types'

function changedFields(change: Change<unknown>): string {
	if (change.kind !== 'update') return change.kind
	const oldRecord = change.oldValue as Record<string, unknown>
	const newRecord = change.newValue as Record<string, unknown>
	const fields = Object.keys(newRecord).filter(
		(key) => JSON.stringify(oldRecord[key]) !== JSON.stringify(newRecord[key]),
	)
	return `update (${fields.join(', ')})`
}

function formatAction(action: StackAction): string {
	switch (action.type) {
		case 'reconcile-workos':
			return `reconcile WorkOS resources: ${changedFields(action.change)}`
		case 'persist-registry':
			return `persist registry record: ${changedFields(action.change)}`
		case 'install-workspace-projection':
			return `install workspace projection: ${changedFields(action.change)}`
		case 'install-caddy-routes':
			return `install Caddy routes: ${changedFields(action.change)}`
		case 'cleanup-legacy-redis':
			return 'remove legacy Redis cluster containers'
		case 'start-compose':
			return 'start Compose stack'
		case 'setup-postgres':
			return 'wait for Postgres and apply migrations'
		case 'seed-organization':
			return 'seed local organization'
	}
}

export function formatStackPlan(plan: StackPlan): string {
	const lines = plan.actions.length === 0 ? ['no changes'] : plan.actions.map(formatAction)
	const redis = plan.desired.redis
	const testRedis = plan.desired.testServices?.redis
	const resolved: string[] = [
		`compose project: ${plan.desired.composeProject}`,
		...Object.entries(plan.desired.ports).map(([name, port]) => `port ${name}: ${port}`),
	]
	if (redis) resolved.push(`Redis port: ${redis.port}`)
	if (testRedis) resolved.push(`test Redis port: ${testRedis.port}`)
	resolved.push(
		...Object.entries(plan.desired.routes).map(([name, route]) => `route ${name}: ${route}`),
		`native icon: ${plan.desired.nativeIcon}`,
	)
	return [
		`Dry run for stack "${plan.stackId}":`,
		...lines.map((line) => `  ${line}`),
		'Resolved values:',
		...resolved.map((line) => `  ${line}`),
		'',
	].join('\n')
}

export function formatStackPlanJson(plan: StackPlan): string {
	return `${JSON.stringify(plan, null, 2)}\n`
}
