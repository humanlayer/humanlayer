import { accessRequests } from './tables/access-requests'
import { aclOperationsLog } from './tables/acl-operations-log'
import { agentCommandDiscoveryRequests } from './tables/agent-command-discovery-requests'
import { agentSlashCommands } from './tables/agent-slash-commands'
import { approvals } from './tables/approvals'
import { anonymousArtifactCommenters, artifactComments } from './tables/artifact-comments'
import { artifactOperationsLog } from './tables/artifact-operations-log'
import { artifactVersions } from './tables/artifact-versions'
import { artifacts } from './tables/artifacts'
import { codelayerAgentState } from './tables/codelayer-agent-state'
import { codelayerAgentStateSnapshots } from './tables/codelayer-agent-state-snapshots'
import { commitWatchWatermarks } from './tables/commit-watch-watermarks'
import { commits } from './tables/commits'
import { contextShards } from './tables/context-shards'
import { conversationEvents } from './tables/conversation-events'
import { diffComments } from './tables/diff-comments'
import { foldSessionEvents } from './tables/fold-session-events'
import { githubIntegrationInstallStates } from './tables/github-integration-install-states'
import { githubIntegrationRepositories } from './tables/github-integration-repositories'
import { githubIntegrations } from './tables/github-integrations'
import { hostAliases } from './tables/host-aliases'
import { jiraIntegrationInstallStates } from './tables/jira-integration-install-states'
import { jiraIntegrations } from './tables/jira-integrations'
import { linearIntegrationInstallStates } from './tables/linear-integration-install-states'
import { linearIntegrations } from './tables/linear-integrations'
import { onlineHosts } from './tables/online-hosts'
import { organizationSettings } from './tables/organization-settings'
import { organizations } from './tables/organizations'
import { projects } from './tables/projects'
import { providerLoginRequests } from './tables/provider-login-requests'
import { publicCommentUndoAuthorizations } from './tables/public-comment-undo-authorizations'
import { pullRequestSessions } from './tables/pull-request-sessions'
import { pullRequests } from './tables/pull-requests'
import { queuedMessages } from './tables/queued-messages'
import { repositoryLocationsForUserForHost } from './tables/repository-locations-for-user-for-host'
import { sessionRepositories } from './tables/session-repositories'
import { sessionUsageEvents } from './tables/session-usage-events'
import { sessions } from './tables/sessions'
import { slackIntegrationInstallStates } from './tables/slack-integration-install-states'
import { slackIntegrations } from './tables/slack-integrations'
import { slackNotificationAutomations } from './tables/slack-notification-automations'
import { slackNotificationThreads } from './tables/slack-notification-threads'
import { taskLaunches } from './tables/task-launches'
import { taskOrganizationAcl } from './tables/task-organization-acl'
import { taskUserAcl } from './tables/task-user-acl'
import { taskUserSettings } from './tables/task-user-settings'
import { taskWorkspaceSetupForHost } from './tables/task-workspace-setup-for-host'
import { tasks } from './tables/tasks'
import { teams } from './tables/teams'
import { userIdentities } from './tables/user-identities'
import { userSettings } from './tables/user-settings'
import { userShardPreferences } from './tables/user-shard-preferences'
import { workspaceLocationsForUserForHost } from './tables/workspace-locations-for-user-for-host'
import { workspaceRepositoryStatusForUserForHost } from './tables/workspace-repository-status-for-user-for-host'
import { workspaces } from './tables/workspaces'

export * from './tables/access-requests'
export * from './tables/acl-operations-log'
export * from './tables/approvals'
export * from './tables/artifact-comments'
export * from './tables/artifact-operations-log'
export * from './tables/artifact-versions'
export * from './tables/artifacts'
export * from './tables/codelayer-agent-state'
export * from './tables/codelayer-agent-state-snapshots'
export * from './tables/commit-watch-watermarks'
export * from './tables/commits'
export * from './tables/context-shards'
export * from './tables/conversation-events'
export * from './tables/diff-comments'
export * from './tables/fold-session-events'
export * from './tables/agent-slash-commands'
export * from './tables/agent-command-discovery-requests'
export * from './tables/host-aliases'
export * from './tables/github-integration-install-states'
export * from './tables/github-integration-repositories'
export * from './tables/github-integrations'
export * from './tables/jira-integration-install-states'
export * from './tables/jira-integrations'
export * from './tables/linear-integration-install-states'
export * from './tables/linear-integrations'
export * from './tables/online-hosts'
export * from './tables/organization-settings'
export * from './tables/organizations'
export * from './tables/projects'
export * from './tables/pull-request-sessions'
export * from './tables/repository-locations-for-user-for-host'
export * from './tables/pull-requests'
export * from './tables/public-comment-undo-authorizations'
export * from './tables/queued-messages'
export * from './tables/session-repositories'
export * from './tables/session-usage-events'
export * from './tables/sessions'
export * from './tables/slack-integration-install-states'
export * from './tables/slack-integrations'
export * from './tables/slack-notification-automations'
export * from './tables/slack-notification-threads'
export * from './tables/task-organization-acl'
export * from './tables/provider-login-requests'
export * from './tables/task-launches'
export * from './tables/task-user-acl'
export * from './tables/task-user-settings'
export * from './tables/task-workspace-setup-for-host'
export * from './tables/tasks'
export * from './tables/teams'
export * from './tables/user-identities'
export * from './tables/user-settings'
export * from './tables/user-shard-preferences'
export * from './tables/workspace-locations-for-user-for-host'
export * from './tables/workspace-repository-status-for-user-for-host'
export * from './tables/workspaces'

export const applicationTables = [
	organizations,
	organizationSettings,
	accessRequests,
	teams,
	projects,
	repositoryLocationsForUserForHost,
	workspaces,
	workspaceLocationsForUserForHost,
	workspaceRepositoryStatusForUserForHost,
	tasks,
	sessions,
	foldSessionEvents,
	conversationEvents,
	diffComments,
	approvals,
	artifacts,
	artifactVersions,
	artifactComments,
	anonymousArtifactCommenters,
	publicCommentUndoAuthorizations,
	artifactOperationsLog,
	aclOperationsLog,
	taskUserAcl,
	taskOrganizationAcl,
	taskLaunches,
	taskUserSettings,
	taskWorkspaceSetupForHost,
	onlineHosts,
	providerLoginRequests,
	hostAliases,
	agentSlashCommands,
	agentCommandDiscoveryRequests,
	githubIntegrations,
	githubIntegrationInstallStates,
	githubIntegrationRepositories,
	jiraIntegrations,
	jiraIntegrationInstallStates,
	linearIntegrations,
	linearIntegrationInstallStates,
	slackIntegrations,
	slackIntegrationInstallStates,
	slackNotificationAutomations,
	slackNotificationThreads,
	codelayerAgentState,
	codelayerAgentStateSnapshots,
	userSettings,
	queuedMessages,
	commits,
	commitWatchWatermarks,
	sessionUsageEvents,
	sessionRepositories,
	pullRequests,
	pullRequestSessions,
	userIdentities,
	contextShards,
	userShardPreferences,
] as const
