import { call } from '@orpc/server'
import { describe, expect, test } from 'vitest'

import { billingInfoProcedure } from '../../src/orpc/api/auth/admin/billing-info'
import { createPortalSessionProcedure } from '../../src/orpc/api/billing/create-portal-session'
import { resyncSeatsProcedure } from '../../src/orpc/api/billing/resync-seats'
import { disconnectJiraProcedure } from '../../src/orpc/api/integrations/jira/disconnect'
import { getJiraIssueProcedure } from '../../src/orpc/api/integrations/jira/get-issue'
import { getJiraStatusProcedure } from '../../src/orpc/api/integrations/jira/get-status'
import { createLinearInstallUrlProcedure } from '../../src/orpc/api/integrations/linear/create-install-url'
import { getLinearIssueMetadataProcedure } from '../../src/orpc/api/integrations/linear/get-issue-metadata'
import { getLinearStatusProcedure } from '../../src/orpc/api/integrations/linear/get-status'
import { createJiraRemoteLinkProcedure } from '../../src/orpc/daemon/integrations/jira/create-remote-link'
import { updateLinearIssueStatusProcedure } from '../../src/orpc/daemon/integrations/linear/update-issue-status'
import {
	createMockApiAuth,
	createMockApiContext,
	createMockDaemonContext,
	createMockJiraService,
	createMockLinearService,
} from '../mocks'

const memberContext = (services: Parameters<typeof createMockApiContext>[0] = {}) =>
	createMockApiContext({ auth: createMockApiAuth(), ...services })

const adminContext = (services: NonNullable<Parameters<typeof createMockApiContext>[0]>['services']) =>
	createMockApiContext({ auth: createMockApiAuth({ role: 'admin', roles: ['admin'] }), services })

const notSetUp = (integration: string) => ({
	code: 'BAD_REQUEST',
	status: 400,
	data: { message: `${integration} is not set up on this deployment` },
})

describe('Jira and Linear without keys', () => {
	test('jira.getStatus answers not set up in the existing shape', async () => {
		const result = await call(getJiraStatusProcedure, {}, { context: memberContext({ services: { jira: null } }) })

		expect(result).toEqual({
			configured: false,
			enabled: false,
			connected: false,
			needsReauth: false,
			siteUrl: null,
		})
	})

	test('linear.getStatus answers not set up in the existing shape', async () => {
		const result = await call(
			getLinearStatusProcedure,
			{},
			{ context: memberContext({ services: { linear: null } }) },
		)

		expect(result).toEqual({ configured: false, enabled: false, connected: false, needsReauth: false })
	})

	test('getStatus reports configured: true when the service exists', async () => {
		const jira = createMockJiraService({
			getIntegrationStatus: async () => ({ enabled: true, connected: true, needsReauth: false, siteUrl: null }),
		})
		const linear = createMockLinearService({
			getIntegrationStatus: async () => ({ enabled: false, connected: false, needsReauth: false }),
		})

		await expect(
			call(getJiraStatusProcedure, {}, { context: memberContext({ services: { jira } }) }),
		).resolves.toMatchObject({ configured: true, connected: true })
		await expect(
			call(getLinearStatusProcedure, {}, { context: memberContext({ services: { linear } }) }),
		).resolves.toMatchObject({ configured: true, connected: false })
	})

	test('requiresJira rejects member and admin procedures with BAD_REQUEST', async () => {
		await expect(
			call(
				getJiraIssueProcedure,
				{ issueKey: 'OPS-1' },
				{ context: memberContext({ services: { jira: null } }) },
			),
		).rejects.toMatchObject(notSetUp('Jira'))
		await expect(
			call(disconnectJiraProcedure, {}, { context: adminContext({ jira: null }) }),
		).rejects.toMatchObject(notSetUp('Jira'))
	})

	test('requiresLinear rejects member and admin procedures with BAD_REQUEST', async () => {
		await expect(
			call(
				getLinearIssueMetadataProcedure,
				{ issueId: 'ENG-1' },
				{ context: memberContext({ services: { linear: null } }) },
			),
		).rejects.toMatchObject(notSetUp('Linear'))
		await expect(
			call(createLinearInstallUrlProcedure, { client: 'cloud' }, { context: adminContext({ linear: null }) }),
		).rejects.toMatchObject(notSetUp('Linear'))
	})

	test('daemon Jira and Linear procedures reject with BAD_REQUEST', async () => {
		await expect(
			call(
				createJiraRemoteLinkProcedure,
				{ issueKey: 'OPS-1', url: 'https://example.com/pr/1', title: 'PR', globalId: 'pr-1' },
				{ context: createMockDaemonContext({ services: { jira: null } }) },
			),
		).rejects.toMatchObject(notSetUp('Jira'))
		await expect(
			call(
				updateLinearIssueStatusProcedure,
				{ issueId: 'ENG-1', statusName: 'In Progress' },
				{ context: createMockDaemonContext({ services: { linear: null } }) },
			),
		).rejects.toMatchObject(notSetUp('Linear'))
	})
})

describe('billing procedures without Stripe', () => {
	test.each([
		['billing.resyncSeats', resyncSeatsProcedure, {}],
		['billing.createPortalSession', createPortalSessionProcedure, { returnUrl: 'https://example.com/settings' }],
		['auth.admin.billing.info', billingInfoProcedure, {}],
	] as const)('%s rejects with BAD_REQUEST', async (_name, procedure, input) => {
		await expect(
			// The tuple widens each procedure to a union; each one accepts its own input.
			call(procedure as typeof resyncSeatsProcedure, input as never, { context: adminContext({ stripe: null }) }),
		).rejects.toMatchObject(notSetUp('Billing'))
	})
})
