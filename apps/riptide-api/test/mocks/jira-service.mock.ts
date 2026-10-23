import type { IJiraService } from '../../src/lib/jira-service'

const notImplemented = (method: string) => async () => {
	throw new Error(`Mock Jira method not implemented: ${method}`)
}

export function createMockJiraService(overrides?: Partial<IJiraService>): IJiraService {
	return {
		createInstallUrl: overrides?.createInstallUrl ?? notImplemented('createInstallUrl'),
		consumeInstallState: overrides?.consumeInstallState ?? notImplemented('consumeInstallState'),
		exchangeCode: overrides?.exchangeCode ?? notImplemented('exchangeCode'),
		getIntegrationStatus: overrides?.getIntegrationStatus ?? notImplemented('getIntegrationStatus'),
		getIssue: overrides?.getIssue ?? notImplemented('getIssue'),
		createRemoteLink: overrides?.createRemoteLink ?? notImplemented('createRemoteLink'),
		disconnect: overrides?.disconnect ?? notImplemented('disconnect'),
	}
}
