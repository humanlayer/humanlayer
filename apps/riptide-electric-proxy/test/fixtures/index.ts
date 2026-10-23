/**
 * Test Fixtures Index
 *
 * Re-exports shared test fixtures from @humanlayer/test-fixtures, with a
 * pre-bound `createElectricTestContext` that injects the proxy's createApp/startServer.
 *
 * Usage:
 * ```ts
 * import {
 *   createElectricTestContext,
 *   createTestUser,
 *   TestUsers,
 *   waitForReady,
 *   expectContains,
 * } from './fixtures'
 * ```
 */

// Collection type exports
export type {
	ApprovalsCollection,
	ArtifactsCollection,
	ArtifactsMetadataCollection,
	DaemonApprovalsCollection,
	EventsCollection,
	HostsCollection,
	SessionsByHostCollection,
	SessionsCollection,
	TaskArtifactsCollection,
	TaskOrgAclCollection,
	TasksCollection,
	TaskUserAclCollection,
} from '@humanlayer/test-fixtures'
// Re-export everything from the shared package EXCEPT createElectricTestContext
// (we override it below with a pre-bound version)
export {
	// Collection factories & types
	type CollectionFactoryOpts,
	type CollectionFromServer,
	// Collection assertions
	type CollectionStatus,
	// Test context types & helpers
	type ContainerConfig,
	createTestUser,
	type ElectricTestContext,
	expectCollectionStatus,
	expectContains,
	expectEmpty,
	expectInitialIdle,
	expectInitialLoading,
	expectItemProperties,
	expectLoadingAfterSubscribe,
	expectNoOverlap,
	expectNotContains,
	expectSameItems,
	expectSize,
	expectSubset,
	type LiveQueryWrapped,
	type ProxyServer,
	setupLiveQuery,
	subscribeAndWaitReady,
	type TestAuthContext,
	type TestOrganization,
	type TestUser,
	TestUsers,
	type WaitOptions,
	waitFor,
	waitForAllReady,
	waitForItem,
	waitForItemProperty,
	waitForItemRemoved,
	waitForMinSize,
	waitForReady,
	waitForSize,
	wrapWithLiveQuery,
} from '@humanlayer/test-fixtures'

import { serve } from '@hono/node-server'
import {
	createElectricTestContext as _createElectricTestContext,
	type SimpleAuthContext,
} from '@humanlayer/test-fixtures'
import { Effect, Layer } from 'effect'

import { JWTValidator } from '../../src/auth/effect/jwt-validator.service'
import { makeProxyRuntimeConfig } from '../../src/lib/effect/proxy-runtime-config.service'
import { createAppRuntime, makeAppLayer } from '../../src/lib/effect/runtime'
import { createApp } from '../../src/server'
import { requireExternalTestServices } from '../utils/external-test-services'

await requireExternalTestServices()

/**
 * Pre-bound createElectricTestContext that injects the electric proxy's
 * createApp/startServer — so existing tests don't need to pass them.
 */
export function createElectricTestContext(opts?: { resetDatabase?: boolean }) {
	return _createElectricTestContext({
		serviceMode: 'external',
		resetDatabase: opts?.resetDatabase ?? true,
		createProxyApp: (config) => {
			const effectRuntime = createAppRuntime(
				makeAppLayer({
					proxyRuntimeConfig: makeProxyRuntimeConfig({
						electricShapeUrl: config.electricShapeUrl,
						durableStreamsOrigin: 'http://127.0.0.1:1',
					}),
					authLayer: Layer.succeed(JWTValidator, {
						validateJWT: () => Effect.fail({ _tag: 'UnexpectedJWTValidation' } as any),
					}),
				}),
			)
			const app = createApp({
				electricShapeUrl: config.electricShapeUrl,
				durableStreamsOrigin: 'http://127.0.0.1:1',
				electricSecret: config.electricSecret,
				effectRuntime,
				testAuthContext: config.testAuthContext as SimpleAuthContext,
				db: config.db as any,
			})
			const server = serve({ fetch: app.fetch, port: 0 })
			const address = server.address()
			if (!address || typeof address === 'string') {
				throw new Error('Expected test proxy server to listen on a TCP port')
			}
			return {
				port: address.port,
				stop: () => {
					server.close()
					void effectRuntime.dispose()
				},
			}
		},
	})
}
