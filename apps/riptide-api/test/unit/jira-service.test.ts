import { describe, expect, test } from 'vitest'

import {
	JiraIntegrationDisabledError,
	JiraIntegrationNotFoundError,
	JiraIssueInputInvalidError,
	JiraIssueNotFoundError,
	JiraProviderUnavailableError,
	JiraReauthRequiredError,
	JiraService,
	parseJiraIssueResponse,
} from '../../src/lib/jira-service'

type JiraResponse = Parameters<typeof parseJiraIssueResponse>[0]

function jiraResponse(key: unknown, summary: unknown): JiraResponse {
	return {
		key,
		fields: { summary },
	} as JiraResponse
}

describe('parseJiraIssueResponse', () => {
	test('rejects a response without fields', () => {
		expect(() =>
			parseJiraIssueResponse({ key: 'ENG-123' } as JiraResponse, 'https://example.atlassian.net'),
		).toThrow(JiraProviderUnavailableError)
	})

	test.each([undefined, '', '   '])('rejects a missing or blank key: %j', (key) => {
		expect(() =>
			parseJiraIssueResponse(jiraResponse(key, 'Valid summary'), 'https://example.atlassian.net'),
		).toThrow(JiraProviderUnavailableError)
	})

	test.each([undefined, '', '   '])('rejects a missing or blank summary: %j', (summary) => {
		expect(() => parseJiraIssueResponse(jiraResponse('ENG-123', summary), 'https://example.atlassian.net')).toThrow(
			JiraProviderUnavailableError,
		)
	})

	test.each(['not a url', 'ftp://example.atlassian.net'])('rejects an invalid Jira site URL: %s', (siteUrl) => {
		expect(() => parseJiraIssueResponse(jiraResponse('ENG-123', 'Valid summary'), siteUrl)).toThrow(
			JiraProviderUnavailableError,
		)
	})

	test('constructs a canonical issue from validated provider data', () => {
		expect(
			parseJiraIssueResponse(jiraResponse(' ENG-123 ', ' Valid summary '), 'https://example.atlassian.net/'),
		).toMatchObject({
			key: 'ENG-123',
			summary: 'Valid summary',
			url: 'https://example.atlassian.net/browse/ENG-123',
		})
	})
})

describe('JiraService.getIssue integration policy', () => {
	// The task-create import path calls getIssue directly, so the org's enabled flag and reauth state
	// have to be enforced inside the service rather than at each caller.
	function serviceWithRows(rows: unknown[]) {
		const service = Object.create(JiraService.prototype) as JiraService
		Object.assign(service, {
			db: {
				select: () => ({
					from: () => ({
						leftJoin: () => ({
							where: () => ({ limit: async () => rows }),
						}),
					}),
				}),
			},
		})
		return service
	}

	const usableIntegration = {
		needs_reauth: false,
		token_expires_at: BigInt(Date.now() + 60 * 60 * 1000),
		cloud_id: 'cloud-1',
		access_token: 'token',
		site_url: 'https://example.atlassian.net',
	}

	test('rejects an organization with no Jira integration', async () => {
		await expect(serviceWithRows([]).getIssue('org-1', 'ENG-123')).rejects.toBeInstanceOf(
			JiraIntegrationNotFoundError,
		)
	})

	test.each([false, null, undefined])(
		'rejects a disabled Jira integration when orgEnabled is %j',
		async (orgEnabled) => {
			const service = serviceWithRows([{ integration: usableIntegration, orgEnabled }])
			await expect(service.getIssue('org-1', 'ENG-123')).rejects.toBeInstanceOf(JiraIntegrationDisabledError)
		},
	)

	test('rejects an integration flagged for reauth before contacting Jira', async () => {
		const service = serviceWithRows([
			{ integration: { ...usableIntegration, needs_reauth: true }, orgEnabled: true },
		])
		await expect(service.getIssue('org-1', 'ENG-123')).rejects.toBeInstanceOf(JiraReauthRequiredError)
	})
})

describe('JiraService.getIssue error classification', () => {
	test.each([
		[{ status: 404 }, JiraIssueNotFoundError],
		[{ status: '404' }, JiraIssueNotFoundError],
		[{ response: { status: 404 } }, JiraIssueNotFoundError],
		[{ cause: { response: { status: '400' } } }, JiraIssueInputInvalidError],
		[{ status: 401 }, JiraReauthRequiredError],
		[{ response: { status: 403 } }, JiraReauthRequiredError],
		[{ status: 'not-a-status' }, JiraProviderUnavailableError],
	] as const)('classifies jira.js error shape %j', async (providerError, expectedError) => {
		const service = Object.create(JiraService.prototype) as JiraService
		Object.assign(service, {
			getAuthedClient: async () => ({
				client: { issues: { getIssue: async () => Promise.reject(providerError) } },
				integration: { site_url: 'https://example.atlassian.net' },
			}),
		})

		await expect(service.getIssue('org-1', 'ENG-123')).rejects.toBeInstanceOf(expectedError)
	})
})
