import { Effect, Layer } from 'effect'

import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'

type DaemonApiShape = (typeof DaemonApi)['Service']

/**
 * Any method the caller does not override dies with a labelled defect, so a test
 * that reaches an unexpected DaemonApi call fails loudly instead of silently
 * returning `undefined`.
 */
function unused(method: keyof DaemonApiShape) {
	return () => Effect.die(`unused DaemonApi method: ${method}`)
}

/**
 * Build a full DaemonApi service where every method is stubbed to die, then
 * apply the given overrides. Keeps tests from re-listing all 18 methods just to
 * exercise one or two.
 */
export function makeMockDaemonApi(overrides: Partial<DaemonApiShape> = {}): DaemonApiShape {
	return {
		getSettings: unused('getSettings'),
		listEnabledContextShards: unused('listEnabledContextShards'),
		updateSession: unused('updateSession'),
		updateWorkspaceSetup: unused('updateWorkspaceSetup'),
		updateProviderLogin: unused('updateProviderLogin'),
		createConversationEvent: unused('createConversationEvent'),
		recordUsage: unused('recordUsage'),
		ensureConversationStream: unused('ensureConversationStream'),
		reportAgentCommands: unused('reportAgentCommands'),
		createApproval: unused('createApproval'),
		appendFoldSessionEvent: unused('appendFoldSessionEvent'),
		listFoldSessionEvents: unused('listFoldSessionEvents'),
		getWorkspaceRepositoryStatus: unused('getWorkspaceRepositoryStatus'),
		reportWorkspaceRepositoryResult: unused('reportWorkspaceRepositoryResult'),
		getArtifactComments: unused('getArtifactComments'),
		updateArtifactComments: unused('updateArtifactComments'),
		replyToArtifactComment: unused('replyToArtifactComment'),
		getDiffComments: unused('getDiffComments'),
		updateDiffComments: unused('updateDiffComments'),
		replyToDiffComment: unused('replyToDiffComment'),
		researchLibrary: unused('researchLibrary'),
		createLinearAttachment: unused('createLinearAttachment'),
		createJiraRemoteLink: unused('createJiraRemoteLink'),
		syncGitHubArtifactBacklink: unused('syncGitHubArtifactBacklink'),
		getSessionWorkspaceSetup: unused('getSessionWorkspaceSetup'),
		getTaskWorkspaceContext: unused('getTaskWorkspaceContext'),
		...overrides,
	}
}

/** `makeMockDaemonApi` wrapped in a `Layer.succeed(DaemonApi, ...)`. */
export function makeMockDaemonApiLayer(overrides: Partial<DaemonApiShape> = {}) {
	return Layer.succeed(DaemonApi, makeMockDaemonApi(overrides))
}
