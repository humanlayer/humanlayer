import { call } from '@orpc/server'
import { Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { AppRuntime } from '../../src/effects/app-runtime'
import { GitHubService } from '../../src/effects/services/github/github.service'
import { unconfiguredGitHubService } from '../../src/effects/services/github/github.unconfigured'
import { ResendService } from '../../src/effects/services/resend/resend.service'
import { unconfiguredResendService } from '../../src/effects/services/resend/resend.unconfigured'
import { SlackService } from '../../src/effects/services/slack/slack.service'
import { unconfiguredSlackService } from '../../src/effects/services/slack/slack.unconfigured'
import { StripeService } from '../../src/effects/services/stripe/stripe.service'
import { unconfiguredStripeService } from '../../src/effects/services/stripe/stripe.unconfigured'
import { getIntegrationCapabilitiesProcedure as liveGetIntegrationCapabilitiesProcedure } from '../../src/orpc/api/integrations/get-capabilities.effect'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'

const memberContext = (services: NonNullable<Parameters<typeof createMockApiContext>[0]>['services'] = {}) =>
	createMockApiContext({ auth: createMockApiAuth({ role: 'member', roles: ['member'] }), services })

describe('integrations.getCapabilities', () => {
	describe('with every integration set up', () => {
		let runtime: AppRuntime
		let getCapabilities: typeof liveGetIntegrationCapabilitiesProcedure

		beforeAll(() => {
			// The default test runtime's Slack, GitHub, Stripe, and Resend fakes all report configured.
			runtime = createRuntimeWithTestPostgresLayer({} as never)
			getCapabilities = bindProcedureToRuntime(liveGetIntegrationCapabilitiesProcedure, runtime)
		})

		afterAll(async () => {
			await runtime?.dispose()
		})

		test('reports each integration and the sender address to any member', async () => {
			await expect(call(getCapabilities, {}, { context: memberContext() })).resolves.toEqual({
				slack: true,
				github: true,
				jira: true,
				linear: true,
				billing: true,
				email: { configured: true, fromAddress: 'notifications@example.test' },
			})
		})
	})

	describe('with nothing set up', () => {
		let runtime: AppRuntime
		let getCapabilities: typeof liveGetIntegrationCapabilitiesProcedure

		beforeAll(() => {
			runtime = createRuntimeWithTestPostgresLayer({} as never, {
				slack: Layer.succeed(SlackService, unconfiguredSlackService),
				github: Layer.succeed(GitHubService, unconfiguredGitHubService),
				stripe: Layer.succeed(StripeService, unconfiguredStripeService),
				resend: Layer.succeed(ResendService, unconfiguredResendService),
			})
			getCapabilities = bindProcedureToRuntime(liveGetIntegrationCapabilitiesProcedure, runtime)
		})

		afterAll(async () => {
			await runtime?.dispose()
		})

		test('reports every integration as not set up, with no sender address', async () => {
			await expect(
				call(getCapabilities, {}, { context: memberContext({ jira: null, linear: null, stripe: null }) }),
			).resolves.toEqual({
				slack: false,
				github: false,
				jira: false,
				linear: false,
				billing: false,
				email: { configured: false },
			})
		})
	})

	test('requires an organization', async () => {
		const runtime = createRuntimeWithTestPostgresLayer({} as never)
		const getCapabilities = bindProcedureToRuntime(liveGetIntegrationCapabilitiesProcedure, runtime)
		try {
			await expect(
				call(getCapabilities, {}, { context: createMockApiContext({ auth: null }) }),
			).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
		} finally {
			await runtime.dispose()
		}
	})
})
