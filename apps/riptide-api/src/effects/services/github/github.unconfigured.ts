import { Effect } from 'effect'

import { GitHubIntegrationNotConfiguredError } from './github.errors'
import type { GitHubServiceShape } from './github.types'

const failGitHubNotConfigured = (operation: string) =>
	Effect.fail(new GitHubIntegrationNotConfiguredError({ operation })).pipe(
		Effect.withSpan(`github.${operation}`, { attributes: { github_configured: false } }),
	)

/**
 * The GitHub service for a deployment with no GitHub App. It has the same methods as the real one,
 * so no caller checks whether GitHub exists:
 * - `listConnections` reports no connections and the integration off;
 * - webhook handling does nothing;
 * - every other method fails with `GitHubIntegrationNotConfiguredError`, which the procedures
 *   answer with "GitHub is not set up on this deployment".
 */
export const unconfiguredGitHubService: GitHubServiceShape = {
	configured: false,
	createInstallUrl: () => failGitHubNotConfigured('create_install_url'),
	completeInstallation: () => failGitHubNotConfigured('complete_installation'),
	listConnections: () => Effect.succeed({ enabled: false, connections: [] }),
	getConnection: () => failGitHubNotConfigured('get_connection'),
	listRepositories: () => failGitHubNotConfigured('list_repositories'),
	getIssuePreview: () => failGitHubNotConfigured('get_issue_preview'),
	prepareIssueImport: () => failGitHubNotConfigured('prepare_issue_import'),
	syncArtifactBacklink: () => failGitHubNotConfigured('sync_artifact_backlink'),
	refreshConnection: () => failGitHubNotConfigured('refresh_connection'),
	disconnect: () => failGitHubNotConfigured('disconnect'),
	fetchPullRequest: () => failGitHubNotConfigured('fetch_pull_request'),
	mutatePullRequest: () => failGitHubNotConfigured('mutate_pull_request'),
	verifyWebhook: () => failGitHubNotConfigured('verify_webhook'),
	handleWebhook: () => Effect.void,
}
