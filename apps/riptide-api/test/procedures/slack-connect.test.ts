import { call } from '@orpc/server'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { SlackIntegrationUnavailableError } from '../../src/effects/services/slack/slack.errors'
import { SlackService } from '../../src/effects/services/slack/slack.service'
import { createSlackInstallUrlProcedure as liveCreateSlackInstallUrlProcedure } from '../../src/orpc/api/integrations/slack/create-install-url.effect'
import { disconnectSlackProcedure as liveDisconnectSlackProcedure } from '../../src/orpc/api/integrations/slack/disconnect.effect'
import { getSlackStatusProcedure as liveGetSlackStatusProcedure } from '../../src/orpc/api/integrations/slack/get-status.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'

describe('Slack connect procedures', () => {
	const organizationId = 'org-slack-connect'
	let runtime: ReturnType<typeof createRuntimeWithTestPostgresLayer>
	let createSlackInstallUrlProcedure: typeof liveCreateSlackInstallUrlProcedure
	let getSlackStatusProcedure: typeof liveGetSlackStatusProcedure
	let disconnectSlackProcedure: typeof liveDisconnectSlackProcedure
	let disconnectCalls = 0

	beforeAll(() => {
		runtime = createRuntimeWithTestPostgresLayer({} as never, {
			slack: Layer.succeed(SlackService, {
				createInstallUrl: ({ organizationId: org, requestedByUserId }) =>
					Effect.succeed({
						url: `https://slack.test/install?org=${org}&user=${requestedByUserId}`,
						expiresAt: 123,
					}),
				exchangeCode: () => Effect.die('exchangeCode not used'),
				getStatus: () =>
					Effect.succeed({
						connected: true,
						enabled: false,
						needsReauth: true,
						teamName: 'HumanLayer',
						lastErrorCode: 'missing_scope',
					}),
				disconnect: () =>
					Effect.sync(() => {
						disconnectCalls += 1
					}),
				listChannels: () => Effect.die('listChannels not used'),
				dispatchArtifactEvent: () => Effect.void,
				dispatchCommentEvent: () => Effect.void,
				verifyInteractionRequest: () => Effect.die('verifyInteractionRequest not used'),
				handleInteractionPayload: () => Effect.void,
			}),
		})
		createSlackInstallUrlProcedure = bindProcedureToRuntime(liveCreateSlackInstallUrlProcedure, runtime)
		getSlackStatusProcedure = bindProcedureToRuntime(liveGetSlackStatusProcedure, runtime)
		disconnectSlackProcedure = bindProcedureToRuntime(liveDisconnectSlackProcedure, runtime)
	})

	afterAll(async () => {
		await runtime?.dispose()
	})

	const context = (role: 'admin' | 'member' = 'admin') =>
		createMockApiContext({
			auth: createMockApiAuth({
				role,
				roles: [role],
				organizationId,
				userId: 'user-slack-admin',
			}),
		})

	test('requires admin access for connect mutations', async () => {
		await expect(call(createSlackInstallUrlProcedure, {}, { context: context('member') })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		})
		await expect(call(disconnectSlackProcedure, {}, { context: context('member') })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		})
	})

	test('creates install URLs, reports status, and disconnects through SlackService', async () => {
		await expect(call(createSlackInstallUrlProcedure, {}, { context: context() })).resolves.toEqual({
			url: 'https://slack.test/install?org=org-slack-connect&user=user-slack-admin',
			expiresAt: 123,
		})

		await expect(call(getSlackStatusProcedure, {}, { context: context('member') })).resolves.toEqual({
			connected: true,
			enabled: false,
			needsReauth: true,
			teamName: 'HumanLayer',
			lastErrorCode: 'missing_scope',
		})

		await expect(call(disconnectSlackProcedure, {}, { context: context() })).resolves.toEqual({ success: true })
		expect(disconnectCalls).toBe(1)
	})

	test('maps Slack service unavailability to service unavailable', async () => {
		const unavailableRuntime = createRuntimeWithTestPostgresLayer({} as never, {
			slack: Layer.succeed(SlackService, {
				createInstallUrl: () => Effect.fail(new SlackIntegrationUnavailableError({ cause: 'db-down' })),
				exchangeCode: () => Effect.die('exchangeCode not used'),
				getStatus: () => Effect.fail(new SlackIntegrationUnavailableError({ cause: 'db-down' })),
				disconnect: () => Effect.fail(new SlackIntegrationUnavailableError({ cause: 'db-down' })),
				listChannels: () => Effect.die('listChannels not used'),
				dispatchArtifactEvent: () => Effect.void,
				dispatchCommentEvent: () => Effect.void,
				verifyInteractionRequest: () => Effect.die('verifyInteractionRequest not used'),
				handleInteractionPayload: () => Effect.void,
			}),
		})
		const unavailableCreate = bindProcedureToRuntime(liveCreateSlackInstallUrlProcedure, unavailableRuntime)

		await expect(call(unavailableCreate, {}, { context: context() })).rejects.toMatchObject({
			code: 'SERVICE_UNAVAILABLE',
		})
		await unavailableRuntime.dispose()
	})
})
