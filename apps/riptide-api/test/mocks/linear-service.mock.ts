import type { ILinearService } from '../../src/lib/linear-service'

const notImplemented = (method: string) => async () => {
	throw new Error(`Mock Linear method not implemented: ${method}`)
}

export function createMockLinearService(overrides?: Partial<ILinearService>): ILinearService {
	return {
		createInstallUrl: overrides?.createInstallUrl ?? notImplemented('createInstallUrl'),
		consumeInstallState: overrides?.consumeInstallState ?? notImplemented('consumeInstallState'),
		exchangeCode: overrides?.exchangeCode ?? notImplemented('exchangeCode'),
		getIntegrationStatus: overrides?.getIntegrationStatus ?? notImplemented('getIntegrationStatus'),
		disconnect: overrides?.disconnect ?? notImplemented('disconnect'),
		updateIssueStatus: overrides?.updateIssueStatus ?? notImplemented('updateIssueStatus'),
		createAttachment: overrides?.createAttachment ?? notImplemented('createAttachment'),
		getIssueMetadata: overrides?.getIssueMetadata ?? notImplemented('getIssueMetadata'),
		getIssue: overrides?.getIssue ?? notImplemented('getIssue'),
		getAccessToken: overrides?.getAccessToken ?? notImplemented('getAccessToken'),
	}
}
