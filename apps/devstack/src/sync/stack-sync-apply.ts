import { Effect } from 'effect'

import { SyncApplyEnvironment } from '../environment/sync-apply-environment'
import { emptyRegistry, type DevstackRegistry } from '../lib/registry'
import { StackSyncApplyError } from './stack-sync.errors'
import type { StackPlan, StackSyncResult } from './stack-sync.types'

export const applyStackSync = (
	plan: StackPlan,
): Effect.Effect<StackSyncResult, StackSyncApplyError, SyncApplyEnvironment> =>
	Effect.gen(function* () {
		const environment = yield* SyncApplyEnvironment
		let stack = plan.desired
		let registry: DevstackRegistry = emptyRegistry()
		let appliedActions = 0

		for (const [index, action] of plan.actions.entries()) {
			const applyAction = (() => {
				switch (action.type) {
					case 'reconcile-workos':
						return environment
							.reconcileWorkOS(stack)
							.pipe(Effect.tap((next) => Effect.sync(() => (stack = next))))
					case 'persist-registry':
						return environment
							.persistRegistry({ registryPath: plan.registryPath, stack })
							.pipe(Effect.tap((next) => Effect.sync(() => (registry = next))))
					case 'install-workspace-projection':
						return environment.installWorkspaceProjection({
							repoRoot: plan.repoRoot,
							registryPath: plan.registryPath,
							stack,
							organization: plan.organization,
						})
					case 'install-caddy-routes':
						return environment.installCaddyRoutes({ registryPath: plan.registryPath, registry })
					case 'cleanup-legacy-redis':
						return environment.cleanupLegacyRedis(action.stack)
					case 'start-compose':
						return environment.startCompose({
							registryPath: plan.registryPath,
							stack,
							organization: plan.organization,
						})
					case 'setup-postgres':
						return environment.setupPostgres(stack)
					case 'seed-organization':
						return environment.seedOrganization({ stack, organization: action.organization })
				}
			})()
			yield* applyAction.pipe(
				Effect.tapError((error) =>
					Effect.logError('Devstack sync action failed').pipe(
						Effect.annotateLogs({
							stackId: plan.stackId,
							action: action.type,
							actionIndex: index,
							operation: error.operation,
						}),
					),
				),
				Effect.catchTag('SyncApplyEnvironmentError', (error) =>
					Effect.fail(
						new StackSyncApplyError({
							action: action.type,
							actionIndex: index,
							reason: error.reason,
							cause: error,
						}),
					),
				),
				Effect.withSpan('devstack.apply_action', {
					attributes: { stackId: plan.stackId, action: action.type, actionIndex: index },
				}),
			)
			appliedActions += 1
		}
		return { stack, appliedActions }
	})
