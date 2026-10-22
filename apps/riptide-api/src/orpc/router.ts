/**
 * This file implements the implementer `os` with the methods we defined
 */

import { discoverWorkspaceAgentCommandsProcedure } from './api/agent-commands/discover-workspace.effect'
import { generateTitleProcedure } from './api/ai/generate-title'
import { resolveApprovalEffectProcedure } from './api/approvals/resolve.effect'
import { createUploadApiArtifactProcedure } from './api/artifacts/create-upload.effect'
import { getArtifactProcedure } from './api/artifacts/get.effect'
import { listArtifactsProcedure } from './api/artifacts/list.effect'
import { updateArtifactDeletionStatusProcedure } from './api/artifacts/update-deletion-status.effect'
import { upsertApiArtifactProcedure } from './api/artifacts/upsert.effect'
import { getArtifactVersionProcedure } from './api/artifacts/versions-get.effect'
import { listArtifactVersionsProcedure } from './api/artifacts/versions-list.effect'
import { adminArchiveAccessRequestProcedure } from './api/auth/admin/access-requests/archive'
import { adminListAccessRequestsProcedure } from './api/auth/admin/access-requests/list'
import { adminCountUnreadAccessRequestsEffectProcedure } from './api/auth/admin/access-requests/unread-count.effect'
import { billingInfoProcedure } from './api/auth/admin/billing-info'
import { createAdminInvitationProcedure } from './api/auth/admin/invitations-create'
import { listAdminInvitationsProcedure } from './api/auth/admin/invitations-list'
import { revokeAdminInvitationProcedure } from './api/auth/admin/invitations-revoke'
import { addDomainProcedure } from './api/auth/admin/organizations-add-domain'
import { generatePortalLinkProcedure } from './api/auth/admin/organizations-generate-portal-link'
import { removeDomainProcedure } from './api/auth/admin/organizations-remove-domain'
import { getOrgSettingsEffectProcedure } from './api/auth/admin/organizations-settings-get.effect'
import { setOrgSettingsEffectProcedure } from './api/auth/admin/organizations-settings-set.effect'
import { adminDeactivateUserProcedure } from './api/auth/admin/users-deactivate'
import { listAdminUsersProcedure } from './api/auth/admin/users-list'
import { adminReactivateUserProcedure } from './api/auth/admin/users-reactivate'
import { adminRemoveUserProcedure } from './api/auth/admin/users-remove'
import { setAdminUserMetricsAdvancedProcedure } from './api/auth/admin/users-set-metrics-advanced'
import { adminUpdateUserRoleProcedure } from './api/auth/admin/users-update-role'
import { createLaunchTokenProcedure } from './api/auth/daemon/launch-token-create'
import { createDaemonTokenProcedure } from './api/auth/daemon/token-create'
import { exchangeLaunchTokenProcedure } from './api/auth/daemon/token-exchange'
import { getCurrentOrganizationProcedure } from './api/auth/organizations/get-current'
import { refreshTokenProcedure } from './api/auth/token-refresh'
import { getUserInfoEffectProcedure } from './api/auth/user/info.effect'
import { acceptUserInvitationProcedure } from './api/auth/user/invitations-accept'
import { listUserInvitationsProcedure } from './api/auth/user/invitations-list'
import { createOrganizationProcedure } from './api/auth/user/organizations-create'
import { listUserOrganizationsProcedure } from './api/auth/user/organizations-list'
import { createPersonalAccessTokenProcedure } from './api/auth/user/personal-access-tokens-create.effect'
import { listPersonalAccessTokensProcedure } from './api/auth/user/personal-access-tokens-list.effect'
import { revokePersonalAccessTokenProcedure } from './api/auth/user/personal-access-tokens-revoke.effect'
import { getUserSettingsEffectProcedure } from './api/auth/user/settings-get.effect'
import { updateUserSettingsEffectProcedure } from './api/auth/user/settings-update.effect'
import { automationRunPrepareProcedure } from './api/automation-run-prepare.effect'
import { applyPromotionCodeProcedure } from './api/billing/apply-promotion-code'
import { createCheckoutSessionProcedure } from './api/billing/create-checkout-session'
import { createPortalSessionProcedure } from './api/billing/create-portal-session'
import { downgradeToStarterProcedure } from './api/billing/downgrade-to-starter'
import { finalizeUpgradeProcedure } from './api/billing/finalize-upgrade'
import { resyncSeatsProcedure } from './api/billing/resync-seats'
import { startUpgradeProcedure } from './api/billing/start-upgrade'
import { syncCheckoutSessionProcedure } from './api/billing/sync-checkout-session'
import { createCommentProcedure } from './api/comments/create'
import { deleteCommentProcedure } from './api/comments/delete.effect'
import { editCommentProcedure } from './api/comments/edit.effect'
import { getApiCommentsProcedure } from './api/comments/get.effect'
import { publicCommentGuestIdentityProcedure } from './api/comments/public-comment-guest-identity.effect'
import { replyApiCommentProcedure } from './api/comments/reply.effect'
import { resolveCommentProcedure } from './api/comments/resolve'
import { resolveAllCommentsProcedure } from './api/comments/resolve-all'
import { resolveBatchCommentsProcedure } from './api/comments/resolve-batch.effect'
import { updateApiCommentProcedure } from './api/comments/update.effect'
import { listContextShardsProcedure } from './api/context-shards/list.effect'
import { restoreContextShardProcedure } from './api/context-shards/restore'
import { updateContextShardPreferenceProcedure } from './api/context-shards/update-preference'
import { createDiffCommentProcedure } from './api/diff-comments/create.effect'
import { deleteDiffCommentProcedure } from './api/diff-comments/delete.effect'
import { editDiffCommentProcedure } from './api/diff-comments/edit.effect'
import { replyDiffCommentProcedure } from './api/diff-comments/reply.effect'
import { resolveBatchDiffCommentsProcedure } from './api/diff-comments/resolve-batch.effect'
import { resolveDiffCommentProcedure } from './api/diff-comments/resolve.effect'
import { getOrHydrateDurableStreamSessionsProcedure } from './api/durable-streams/sessions'
import { listHostAliasesEffectProcedure } from './api/hosts/alias-list.effect'
import { upsertHostAliasEffectProcedure } from './api/hosts/alias-upsert.effect'
import { deleteHostEffectProcedure } from './api/hosts/delete.effect'
import { requestHostUpdateEffectProcedure } from './api/hosts/update-request.effect'
import { createGitHubInstallUrlProcedure } from './api/integrations/github/create-install-url.effect'
import { disconnectGitHubProcedure } from './api/integrations/github/disconnect.effect'
import { getGitHubConnectionProcedure } from './api/integrations/github/get-connection.effect'
import { getGitHubIssuePreviewProcedure } from './api/integrations/github/get-issue-preview.effect'
import { getGitHubStatusProcedure } from './api/integrations/github/get-status.effect'
import { listGitHubConnectionsProcedure } from './api/integrations/github/list-connections.effect'
import { listGitHubRepositoriesProcedure } from './api/integrations/github/list-repositories.effect'
import { ensurePullRequestStreamProcedure } from './api/integrations/github/pull-requests/ensure-stream.effect'
import { listPullRequestBranchesProcedure } from './api/integrations/github/pull-requests/list-branches.effect'
import { mutatePullRequestProcedure } from './api/integrations/github/pull-requests/mutate.effect'
import { refreshGitHubConnectionProcedure } from './api/integrations/github/refresh-connection.effect'
import { createJiraInstallUrlProcedure } from './api/integrations/jira/create-install-url'
import { disconnectJiraProcedure } from './api/integrations/jira/disconnect'
import { getJiraIssueProcedure } from './api/integrations/jira/get-issue'
import { getJiraStatusProcedure } from './api/integrations/jira/get-status'
import { createLinearInstallUrlProcedure } from './api/integrations/linear/create-install-url'
import { disconnectLinearProcedure } from './api/integrations/linear/disconnect'
import { getLinearIssueProcedure } from './api/integrations/linear/get-issue'
import { getLinearIssueMetadataProcedure } from './api/integrations/linear/get-issue-metadata'
import { getLinearStatusProcedure } from './api/integrations/linear/get-status'
import { createSlackAutomationProcedure } from './api/integrations/slack/create-automation.effect'
import { createSlackInstallUrlProcedure } from './api/integrations/slack/create-install-url.effect'
import { deleteSlackAutomationProcedure } from './api/integrations/slack/delete-automation.effect'
import { disconnectSlackProcedure } from './api/integrations/slack/disconnect.effect'
import { getSlackStatusProcedure } from './api/integrations/slack/get-status.effect'
import { listSlackAutomationsProcedure } from './api/integrations/slack/list-automations.effect'
import { listSlackChannelsProcedure } from './api/integrations/slack/list-channels.effect'
import { updateSlackAutomationProcedure } from './api/integrations/slack/update-automation.effect'
import {
	activeUsersCollaborationInboundProcedure,
	activeUsersCollaborationOutboundProcedure,
	activeUsersCommentsProcedure,
	activeUsersSessionsProcedure,
} from './api/metrics/activeUsersCharts'
import { agentCommitsByRepoProcedure } from './api/metrics/agentCommitsByRepo'
import { costPerKlocByModelProcedure } from './api/metrics/costPerKlocByModel'
import { dailyActiveUsersProcedure } from './api/metrics/dailyActiveUsers'
import { modelSpendTrendProcedure } from './api/metrics/modelSpendTrend'
import { modeSpendTrendProcedure } from './api/metrics/modeSpendTrend'
import { mostSessionsProcedure } from './api/metrics/mostSessions'
import { rangeOverviewProcedure } from './api/metrics/rangeOverview'
import { scatterFilterOptionsProcedure } from './api/metrics/scatterFilterOptions'
import { sessionsPerDayProcedure } from './api/metrics/sessionsPerDay'
import { sessionsPerWeekProcedure } from './api/metrics/sessionsPerWeek'
import { stageSpendTrendProcedure } from './api/metrics/stageSpendTrend'
import { taskFanOutProcedure } from './api/metrics/taskFanOut'
import { tokenUseByTaskProcedure } from './api/metrics/tokenUseByTask'
import { unitCostTrendProcedure } from './api/metrics/unitCostTrend'
import { usageByModelProcedure } from './api/metrics/usageByModel'
import { usageTrendEffectProcedure } from './api/metrics/usageTrend.effect'
import { userModeSpendProcedure } from './api/metrics/userModeSpend.effect'
import { usersScatterProcedure } from './api/metrics/usersScatter'
import { userStageSpendProcedure } from './api/metrics/userStageSpend.effect'
import { weeklyActiveUsersProcedure } from './api/metrics/weeklyActiveUsers'
import { listActiveOrgMembersProcedure, listOrgMembersProcedure } from './api/org/members-list'
import { getProjectWorkspaceStatusProcedure } from './api/project-workspaces/get-status.effect'
import { recoverProjectWorkspaceRepositorySourceProcedure } from './api/project-workspaces/repository-source-recover.effect'
import { getProjectWorkspaceRepositorySourcesProcedure } from './api/project-workspaces/repository-sources-get.effect'
import { upsertProjectWorkspaceRepositorySourcesProcedure } from './api/project-workspaces/repository-sources-upsert.effect'
import { retryProjectWorkspaceRepositorySetupProcedure } from './api/project-workspaces/retry-repository-setup.effect'
import { skipProjectWorkspaceRepositorySetupStepProcedure } from './api/project-workspaces/skip-repository-setup-step.effect'
import { archiveProjectV2Procedure } from './api/projects-v2/archive.effect'
import { createProjectV2Procedure } from './api/projects-v2/create.effect'
import { getProjectV2Procedure } from './api/projects-v2/get.effect'
import { listProjectsV2Procedure } from './api/projects-v2/list.effect'
import { upsertProjectV2LocationProcedure } from './api/projects-v2/location-upsert.effect'
import { getProjectV2RepositorySourcesProcedure } from './api/projects-v2/repository-sources-get.effect'
import { upsertProjectV2RepositorySourcesProcedure } from './api/projects-v2/repository-sources-upsert.effect'
import { updateProjectV2Procedure } from './api/projects-v2/update.effect'
import {
	cancelProviderLoginProcedure,
	createProviderLoginProcedure,
	listProviderLoginsProcedure,
	submitProviderLoginCodeProcedure,
} from './api/provider-login'
import { createAccessRequestProcedure } from './api/public/access-requests/create'
import { sharedArtifactCommentAuthorsProcedure } from './api/public/artifacts/comment-authors.effect'
import { createPublicArtifactCommentProcedure } from './api/public/artifacts/create-comment.effect'
import { sharedArtifactDownloadUrlProcedure } from './api/public/artifacts/download-url'
import { artifactInfoProcedure } from './api/public/artifacts/info'
import { resolveSharedArtifactProcedure } from './api/public/artifacts/resolve.effect'
import { undoPublicArtifactCommentProcedure } from './api/public/artifacts/undo-comment.effect'
import { continueSessionProcedure } from './api/sessions/continue'
import { createSessionProcedure } from './api/sessions/create'
import { listSessionEventsProcedure } from './api/sessions/events/list.effect'
import { forkSessionProcedure, forkSessionV2Procedure } from './api/sessions/fork'
import { handoffSessionProcedure } from './api/sessions/handoff'
import { interruptSessionProcedure } from './api/sessions/interrupt'
import { launchSessionProcedure } from './api/sessions/launch'
import { listSessionsEffectProcedure } from './api/sessions/list.effect'
import { updateMultiplayerPromptingEffectProcedure } from './api/sessions/multiplayer-prompting/update.effect'
import {
	createQueuedMessageEffectProcedure,
	deleteQueuedMessageEffectProcedure,
} from './api/sessions/queued-messages.effect'
import { sendNowQueuedMessageEffectProcedure } from './api/sessions/queued-messages.send-now.effect'
import { updateQueuedMessageEffectProcedure } from './api/sessions/queued-messages.update.effect'
import { updateSessionApiProcedure } from './api/sessions/update'
import { updateSessionStatusProcedure } from './api/sessions/update-status'
import { continueSessionV2Procedure } from './api/sessions/v2/continue'
import { createSessionV2Procedure } from './api/sessions/v2/create.effect'
import { updateArtifactSharingProcedure } from './api/sharing/artifact/update.effect'
import { updateOrgSharingProcedure } from './api/sharing/organization/update.effect'
import { updateUserSharingProcedure } from './api/sharing/user/update.effect'
import { syncApprovalsEffectProcedure } from './api/sync/approvals.effect'
import { syncArtifactCommentsProcedure } from './api/sync/artifact-comments'
import { syncArtifactsProcedure } from './api/sync/artifacts'
import { syncArtifactsMetadataProcedure } from './api/sync/artifacts-metadata'
import { syncConversationEventsProcedure } from './api/sync/conversation-events'
import { syncOnlineHostsProcedure } from './api/sync/online-hosts'
import { syncQueuedMessagesProcedure } from './api/sync/queued-messages'
import { syncSessionsProcedure } from './api/sync/sessions'
import { syncTaskOrganizationAclsProcedure } from './api/sync/task-organization-acls'
import { syncTaskUserAclsProcedure } from './api/sync/task-user-acls'
import { syncTaskUserSettingsProcedure } from './api/sync/task-user-settings'
import { syncTasksProcedure } from './api/sync/tasks'
import { syncV2AgentSlashCommandsEffectProcedure } from './api/sync/v2/agent-slash-commands.effect'
import { syncV2ApprovalsProcedure } from './api/sync/v2/approvals'
import { syncV2ArtifactCommentsProcedure } from './api/sync/v2/artifact-comments'
import { syncV2ArtifactsProcedure } from './api/sync/v2/artifacts'
import { syncV2ArtifactsMetadataProcedure } from './api/sync/v2/artifacts-metadata'
import { syncV2ConversationEventsProcedure } from './api/sync/v2/conversation-events'
import { syncV2DiffCommentsProcedure } from './api/sync/v2/diff-comments'
import { syncV2OnlineHostsProcedure } from './api/sync/v2/online-hosts'
import { syncV2ProviderLoginRequestsProcedure } from './api/sync/v2/provider-login-requests'
import { syncV2QueuedMessagesProcedure } from './api/sync/v2/queued-messages'
import { syncV2SessionsProcedure } from './api/sync/v2/sessions'
import { syncV2TaskOrganizationAclsProcedure } from './api/sync/v2/task-organization-acls'
import { syncV2TaskUserAclsProcedure } from './api/sync/v2/task-user-acls'
import { syncV2TaskUserSettingsProcedure } from './api/sync/v2/task-user-settings'
import { syncV2TaskWorkspaceSetupForHostProcedure } from './api/sync/v2/task-workspace-setup-for-host'
import { syncV2TasksProcedure } from './api/sync/v2/tasks'
import { upsertTaskUserSettingsProcedure } from './api/task-user-settings/upsert.effect'
import { archiveTaskProcedure } from './api/tasks/archive'
import { createTaskProcedure } from './api/tasks/create'
import { createTaskDraftEffectProcedure } from './api/tasks/createDraft.effect'
import { launchTaskDraftProcedure } from './api/tasks/launch-draft'
import { listTasksProcedure } from './api/tasks/list.effect'
import { reassignTaskOwnerProcedure } from './api/tasks/reassign-owner'
import { saveTaskDraftProcedure } from './api/tasks/saveDraft'
import { updateTaskProcedure } from './api/tasks/update'
import { createTaskV2Procedure } from './api/tasks/v2/create.effect'
import { createUploadProcedure } from './api/uploads/create.effect'
import { getDownloadUrlProcedure } from './api/uploads/download-url.effect'
import { getPresignedUrlProcedure } from './api/uploads/get-presigned-url.effect'
import { upsertTextArtifactProcedure } from './api/uploads/upsert-text.effect'
import { getPresignedUrlV2Procedure } from './api/uploads/v2/get-presigned-url.effect'
import { retryWorkspaceSetupStepProcedure } from './api/workspace-setup/retry-step'
import { skipWorkspaceSetupStepProcedure } from './api/workspace-setup/skip-step'
import { updateWorkspaceSetupRepositoryDirectoryProcedure } from './api/workspace-setup/update-repository-directory'
import { daemonBase, os } from './base'
import { reportAgentCommandsProcedure } from './daemon/agent-commands/report.effect'
import { researchProcedure } from './daemon/agents/research'
import { createApprovalProcedure } from './daemon/approvals/create'
import { daemonCreateUploadProcedure } from './daemon/artifacts/create-upload'
import { getDaemonDownloadUrlProcedure } from './daemon/artifacts/download-url'
import { upsertArtifactProcedure } from './daemon/artifacts/upsert'
import { getCodelayerStateEffectProcedure } from './daemon/codelayer-state/get.effect'
import { getCodelayerStateSnapshotEffectProcedure } from './daemon/codelayer-state/snapshot-get.effect'
import { upsertCodelayerStateEffectProcedure } from './daemon/codelayer-state/upsert.effect'
import { getCommentsProcedure } from './daemon/comments/get'
import { replyCommentProcedure } from './daemon/comments/reply'
import { updateCommentProcedure } from './daemon/comments/update'
import { recordObservedCommitsProcedure } from './daemon/commits/record-observed.effect'
import { getCommitWatermarksProcedure, setCommitWatermarkProcedure } from './daemon/commits/watermark.effect'
import { daemonListEnabledContextShardsProcedure } from './daemon/context-shards/list-enabled.effect'
import { getDiffCommentsProcedure } from './daemon/diff-comments/get.effect'
import { replyToDiffCommentProcedure } from './daemon/diff-comments/reply.effect'
import { updateDiffCommentsProcedure } from './daemon/diff-comments/update.effect'
import { appendFoldSessionEventProcedure } from './daemon/fold-session-events/append.effect'
import { listFoldSessionEventsProcedure } from './daemon/fold-session-events/list.effect'
import { heartbeatEffectProcedure } from './daemon/hosts/heartbeat.effect'
import { shutdownEffectProcedure } from './daemon/hosts/shutdown.effect'
import { syncGitHubArtifactBacklinkProcedure } from './daemon/integrations/github/sync-artifact-backlink.effect'
import { createJiraRemoteLinkProcedure } from './daemon/integrations/jira/create-remote-link'
import { createLinearAttachmentProcedure } from './daemon/integrations/linear/create-attachment'
import { updateLinearIssueStatusProcedure } from './daemon/integrations/linear/update-issue-status'
import { getWorkspaceRepositoryStatusProcedure } from './daemon/project-workspaces/get-repository-status.effect'
import { getSessionWorkspaceSetupProcedure } from './daemon/project-workspaces/get-session-workspace-setup.effect'
import { getTaskWorkspaceContextProcedure } from './daemon/project-workspaces/get-task-workspace-context.effect'
import { advanceRepositorySetupStageProcedure } from './daemon/project-workspaces/report-repository-result.effect'
import { updateDaemonProviderLoginProcedure } from './daemon/provider-login/update'
import { listOpenPullRequestsForHostProcedure } from './daemon/pull-requests/list-open-for-host.effect'
import { refreshPullRequestStatusProcedure } from './daemon/pull-requests/refresh-status.effect'
import { recordCommitsProcedure } from './daemon/sessions/commits/record.effect'
import { ensureStreamHydratedProcedure } from './daemon/sessions/ensure-stream-hydrated'
import { createEventProcedure } from './daemon/sessions/events/create'
import { upsertSessionPullRequestProcedure } from './daemon/sessions/pull-requests/upsert.effect'
import { reportSessionRepositoriesProcedure } from './daemon/sessions/repositories/report.effect'
import { updateSessionProcedure } from './daemon/sessions/update'
import { recordSessionUsageEffectProcedure } from './daemon/sessions/usage/record.effect'
import { daemonGetSettingsEffectProcedure } from './daemon/settings/get.effect'
import { syncDaemonApprovalsProcedure } from './daemon/sync/approvals'
import { syncDaemonArtifactsProcedure } from './daemon/sync/artifacts'
import { syncDaemonSessionsProcedure } from './daemon/sync/sessions'
import { syncDaemonTaskWorkspaceSetupForHostProcedure } from './daemon/sync/task-workspace-setup-for-host'
import { syncDaemonTasksProcedure } from './daemon/sync/tasks'
import { setGithubIdentityProcedure } from './daemon/users/set-github-identity.effect'
import { updateDaemonWorkspaceSetupProcedure } from './daemon/workspace-setup/update'

export const apiRouter = os.router({
	public: {
		accessRequests: {
			create: createAccessRequestProcedure,
		},
		artifacts: {
			info: artifactInfoProcedure,
			downloadUrl: sharedArtifactDownloadUrlProcedure,
			resolve: resolveSharedArtifactProcedure,
			commentAuthors: sharedArtifactCommentAuthorsProcedure,
			createComment: createPublicArtifactCommentProcedure,
			undoComment: undoPublicArtifactCommentProcedure,
		},
	},
	metrics: {
		activeUsersCollaborationInbound: activeUsersCollaborationInboundProcedure,
		activeUsersCollaborationOutbound: activeUsersCollaborationOutboundProcedure,
		activeUsersComments: activeUsersCommentsProcedure,
		activeUsersSessions: activeUsersSessionsProcedure,
		agentCommitsByRepo: agentCommitsByRepoProcedure,
		costPerKlocByModel: costPerKlocByModelProcedure,
		modeSpendTrend: modeSpendTrendProcedure,
		modelSpendTrend: modelSpendTrendProcedure,
		unitCostTrend: unitCostTrendProcedure,
		dailyActiveUsers: dailyActiveUsersProcedure,
		mostSessions: mostSessionsProcedure,
		rangeOverview: rangeOverviewProcedure,
		scatterFilterOptions: scatterFilterOptionsProcedure,
		sessionsPerDay: sessionsPerDayProcedure,
		sessionsPerWeek: sessionsPerWeekProcedure,
		stageSpendTrend: stageSpendTrendProcedure,
		taskFanOut: taskFanOutProcedure,
		tokenUseByTask: tokenUseByTaskProcedure,
		usageByModel: usageByModelProcedure,
		usageTrend: usageTrendEffectProcedure,
		usersScatter: usersScatterProcedure,
		userStageSpend: userStageSpendProcedure,
		userModeSpend: userModeSpendProcedure,
		weeklyActiveUsers: weeklyActiveUsersProcedure,
	},
	automation: {
		run: {
			prepare: automationRunPrepareProcedure,
		},
	},
	auth: {
		user: {
			info: getUserInfoEffectProcedure,
			personalAccessTokens: {
				create: createPersonalAccessTokenProcedure,
				list: listPersonalAccessTokensProcedure,
				revoke: revokePersonalAccessTokenProcedure,
			},
			settings: {
				get: getUserSettingsEffectProcedure,
				update: updateUserSettingsEffectProcedure,
			},
			organizations: {
				list: listUserOrganizationsProcedure,
				create: createOrganizationProcedure,
			},
			invitations: {
				list: listUserInvitationsProcedure,
				accept: acceptUserInvitationProcedure,
			},
		},
		organizations: {
			getCurrent: getCurrentOrganizationProcedure,
		},

		admin: {
			accessRequests: {
				list: adminListAccessRequestsProcedure,
				unreadCount: adminCountUnreadAccessRequestsEffectProcedure,
				archive: adminArchiveAccessRequestProcedure,
			},
			invitations: {
				list: listAdminInvitationsProcedure,
				create: createAdminInvitationProcedure,
				revoke: revokeAdminInvitationProcedure,
			},
			users: {
				list: listAdminUsersProcedure,
				updateRole: adminUpdateUserRoleProcedure,
				remove: adminRemoveUserProcedure,
				deactivate: adminDeactivateUserProcedure,
				reactivate: adminReactivateUserProcedure,
				setMetricsAdvancedEnabled: setAdminUserMetricsAdvancedProcedure,
			},
			billing: {
				info: billingInfoProcedure,
			},
			organizations: {
				addDomain: addDomainProcedure,
				removeDomain: removeDomainProcedure,
				generatePortalLink: generatePortalLinkProcedure,
				settings: {
					get: getOrgSettingsEffectProcedure,
					set: setOrgSettingsEffectProcedure,
				},
			},
		},
		token: {
			refresh: refreshTokenProcedure,
		},
		daemon: {
			token: {
				create: createDaemonTokenProcedure,
				exchange: exchangeLaunchTokenProcedure,
			},
			launchToken: {
				create: createLaunchTokenProcedure,
			},
		},
	},
	sessions: {
		create: createSessionProcedure,
		fork: forkSessionProcedure,
		handoff: handoffSessionProcedure,
		v2: {
			fork: forkSessionV2Procedure,
			continue: continueSessionV2Procedure,
			create: createSessionV2Procedure,
		},
		launch: launchSessionProcedure,
		update: updateSessionApiProcedure,
		updateStatus: updateSessionStatusProcedure,
		continue: continueSessionProcedure,
		interrupt: interruptSessionProcedure,
		list: listSessionsEffectProcedure,
		multiplayerPrompting: { update: updateMultiplayerPromptingEffectProcedure },
		events: {
			list: listSessionEventsProcedure,
		},
		queuedMessages: {
			create: createQueuedMessageEffectProcedure,
			update: updateQueuedMessageEffectProcedure,
			delete: deleteQueuedMessageEffectProcedure,
			sendNow: sendNowQueuedMessageEffectProcedure,
		},
	},
	tasks: {
		create: createTaskProcedure,
		createDraft: createTaskDraftEffectProcedure,
		launchDraft: launchTaskDraftProcedure,
		saveDraft: saveTaskDraftProcedure,
		update: updateTaskProcedure,
		reassignOwner: reassignTaskOwnerProcedure,
		archive: archiveTaskProcedure,
		list: listTasksProcedure,
		v2: {
			create: createTaskV2Procedure,
		},
	},
	projects: {
		v2: {
			list: listProjectsV2Procedure,
			get: getProjectV2Procedure,
			create: createProjectV2Procedure,
			update: updateProjectV2Procedure,
			archive: archiveProjectV2Procedure,
			locations: { upsert: upsertProjectV2LocationProcedure },
			repositorySources: {
				get: getProjectV2RepositorySourcesProcedure,
				upsert: upsertProjectV2RepositorySourcesProcedure,
			},
		},
	},
	projectWorkspaces: {
		getStatus: getProjectWorkspaceStatusProcedure,
		repositorySources: {
			get: getProjectWorkspaceRepositorySourcesProcedure,
			upsert: upsertProjectWorkspaceRepositorySourcesProcedure,
			recover: recoverProjectWorkspaceRepositorySourceProcedure,
		},
		retryRepositorySetup: retryProjectWorkspaceRepositorySetupProcedure,
		skipRepositorySetupStep: skipProjectWorkspaceRepositorySetupStepProcedure,
	},
	organization: {
		members: {
			list: listOrgMembersProcedure,
			listActive: listActiveOrgMembersProcedure,
		},
	},
	sharing: {
		organization: {
			update: updateOrgSharingProcedure,
		},
		user: {
			update: updateUserSharingProcedure,
		},
		artifact: {
			update: updateArtifactSharingProcedure,
		},
	},
	approvals: {
		resolve: resolveApprovalEffectProcedure,
	},
	durableStreams: {
		sessions: {
			getOrHydrate: getOrHydrateDurableStreamSessionsProcedure,
		},
	},
	comments: {
		get: getApiCommentsProcedure,
		update: updateApiCommentProcedure,
		reply: replyApiCommentProcedure,
		create: createCommentProcedure,
		resolve: resolveCommentProcedure,
		resolveAll: resolveAllCommentsProcedure,
		resolveBatch: resolveBatchCommentsProcedure,
		delete: deleteCommentProcedure,
		edit: editCommentProcedure,
		publicCommentGuestIdentity: publicCommentGuestIdentityProcedure,
	},
	diffComments: {
		create: createDiffCommentProcedure,
		reply: replyDiffCommentProcedure,
		edit: editDiffCommentProcedure,
		delete: deleteDiffCommentProcedure,
		resolve: resolveDiffCommentProcedure,
		resolveBatch: resolveBatchDiffCommentsProcedure,
	},
	billing: {
		applyPromotionCode: applyPromotionCodeProcedure,
		createCheckoutSession: createCheckoutSessionProcedure,
		createPortalSession: createPortalSessionProcedure,
		downgradeToStarter: downgradeToStarterProcedure,
		finalizeUpgrade: finalizeUpgradeProcedure,
		resyncSeats: resyncSeatsProcedure,
		startUpgrade: startUpgradeProcedure,
		syncCheckoutSession: syncCheckoutSessionProcedure,
	},
	artifacts: {
		list: listArtifactsProcedure,
		get: getArtifactProcedure,
		versions: {
			list: listArtifactVersionsProcedure,
			get: getArtifactVersionProcedure,
		},
		upsert: upsertApiArtifactProcedure,
		createUpload: createUploadApiArtifactProcedure,
		updateDeletionStatus: updateArtifactDeletionStatusProcedure,
	},
	taskUserSettings: {
		upsert: upsertTaskUserSettingsProcedure,
	},
	contextShards: {
		list: listContextShardsProcedure,
		updatePreference: updateContextShardPreferenceProcedure,
		restore: restoreContextShardProcedure,
	},
	workspaceSetup: {
		retryStep: retryWorkspaceSetupStepProcedure,
		skipStep: skipWorkspaceSetupStepProcedure,
		updateRepositoryDirectory: updateWorkspaceSetupRepositoryDirectoryProcedure,
	},
	providerLogin: {
		create: createProviderLoginProcedure,
		submitCode: submitProviderLoginCodeProcedure,
		cancel: cancelProviderLoginProcedure,
		list: listProviderLoginsProcedure,
	},
	agentCommands: {
		discoverWorkspace: discoverWorkspaceAgentCommandsProcedure,
	},
	ai: {
		generateTitle: generateTitleProcedure,
	},
	sync: {
		sessions: syncSessionsProcedure,
		tasks: syncTasksProcedure,
		conversationEvents: syncConversationEventsProcedure,
		approvals: syncApprovalsEffectProcedure,
		artifactComments: syncArtifactCommentsProcedure,
		artifacts: syncArtifactsProcedure,
		artifactsMetadata: syncArtifactsMetadataProcedure,
		queuedMessages: syncQueuedMessagesProcedure,
		v2: {
			sessions: syncV2SessionsProcedure,
			tasks: syncV2TasksProcedure,
			conversationEvents: syncV2ConversationEventsProcedure,
			approvals: syncV2ApprovalsProcedure,
			artifactComments: syncV2ArtifactCommentsProcedure,
			diffComments: syncV2DiffCommentsProcedure,
			artifacts: syncV2ArtifactsProcedure,
			artifactsMetadata: syncV2ArtifactsMetadataProcedure,
			queuedMessages: syncV2QueuedMessagesProcedure,
			taskOrganizationAcls: syncV2TaskOrganizationAclsProcedure,
			taskUserAcls: syncV2TaskUserAclsProcedure,
			taskUserSettings: syncV2TaskUserSettingsProcedure,
			taskWorkspaceSetupForHost: syncV2TaskWorkspaceSetupForHostProcedure,
			onlineHosts: syncV2OnlineHostsProcedure,
			agentSlashCommands: syncV2AgentSlashCommandsEffectProcedure,
			providerLoginRequests: syncV2ProviderLoginRequestsProcedure,
		},
		onlineHosts: syncOnlineHostsProcedure,
		taskOrganizationAcls: syncTaskOrganizationAclsProcedure,
		taskUserAcls: syncTaskUserAclsProcedure,
		taskUserSettings: syncTaskUserSettingsProcedure,
	},
	uploads: {
		create: createUploadProcedure,
		getPresignedUrl: getPresignedUrlProcedure,
		downloadUrl: getDownloadUrlProcedure,
		upsertText: upsertTextArtifactProcedure,
		v2: {
			getPresignedUrl: getPresignedUrlV2Procedure,
		},
	},
	integrations: {
		github: {
			createInstallUrl: createGitHubInstallUrlProcedure,
			getStatus: getGitHubStatusProcedure,
			listConnections: listGitHubConnectionsProcedure,
			getConnection: getGitHubConnectionProcedure,
			getIssuePreview: getGitHubIssuePreviewProcedure,
			listRepositories: listGitHubRepositoriesProcedure,
			refreshConnection: refreshGitHubConnectionProcedure,
			disconnect: disconnectGitHubProcedure,
			pullRequests: {
				ensureStream: ensurePullRequestStreamProcedure,
				listPullRequestBranches: listPullRequestBranchesProcedure,
				mutate: mutatePullRequestProcedure,
			},
		},
		jira: {
			createInstallUrl: createJiraInstallUrlProcedure,
			getStatus: getJiraStatusProcedure,
			getIssue: getJiraIssueProcedure,
			disconnect: disconnectJiraProcedure,
		},
		linear: {
			createInstallUrl: createLinearInstallUrlProcedure,
			getStatus: getLinearStatusProcedure,
			getIssue: getLinearIssueProcedure,
			getIssueMetadata: getLinearIssueMetadataProcedure,
			disconnect: disconnectLinearProcedure,
		},
		slack: {
			createInstallUrl: createSlackInstallUrlProcedure,
			getStatus: getSlackStatusProcedure,
			disconnect: disconnectSlackProcedure,
			listChannels: listSlackChannelsProcedure,
			listAutomations: listSlackAutomationsProcedure,
			createAutomation: createSlackAutomationProcedure,
			updateAutomation: updateSlackAutomationProcedure,
			deleteAutomation: deleteSlackAutomationProcedure,
		},
	},
	hosts: {
		delete: deleteHostEffectProcedure,
		alias: {
			upsert: upsertHostAliasEffectProcedure,
			list: listHostAliasesEffectProcedure,
		},
		update: {
			request: requestHostUpdateEffectProcedure,
		},
	},
})

export const daemonRouter = daemonBase.router({
	workspaceSetup: { update: updateDaemonWorkspaceSetupProcedure },
	providerLogin: { update: updateDaemonProviderLoginProcedure },
	hosts: {
		heartbeat: heartbeatEffectProcedure,
		shutdown: shutdownEffectProcedure,
	},
	comments: {
		get: getCommentsProcedure,
		update: updateCommentProcedure,
		reply: replyCommentProcedure,
	},
	diffComments: {
		get: getDiffCommentsProcedure,
		update: updateDiffCommentsProcedure,
		reply: replyToDiffCommentProcedure,
	},
	sessions: {
		events: {
			create: createEventProcedure,
		},
		commits: {
			record: recordCommitsProcedure,
		},
		usage: {
			record: recordSessionUsageEffectProcedure,
		},
		pullRequests: {
			upsert: upsertSessionPullRequestProcedure,
		},
		repositories: {
			report: reportSessionRepositoriesProcedure,
		},
		update: updateSessionProcedure,
		ensureStreamHydrated: ensureStreamHydratedProcedure,
	},
	commits: {
		recordObserved: recordObservedCommitsProcedure,
		watermark: {
			get: getCommitWatermarksProcedure,
			set: setCommitWatermarkProcedure,
		},
	},
	pullRequests: {
		listOpenForHost: listOpenPullRequestsForHostProcedure,
		refreshStatus: refreshPullRequestStatusProcedure,
	},
	projectWorkspaces: {
		getRepositoryStatus: getWorkspaceRepositoryStatusProcedure,
		getSessionWorkspaceSetup: getSessionWorkspaceSetupProcedure,
		getTaskWorkspaceContext: getTaskWorkspaceContextProcedure,
		reportRepositoryResult: advanceRepositorySetupStageProcedure,
	},
	users: {
		setGithubIdentity: setGithubIdentityProcedure,
	},
	approvals: {
		create: createApprovalProcedure,
	},
	agents: {
		research: researchProcedure,
	},
	agentCommands: {
		report: reportAgentCommandsProcedure,
	},
	codelayerState: {
		get: getCodelayerStateEffectProcedure,
		snapshot: {
			get: getCodelayerStateSnapshotEffectProcedure,
		},
		upsert: upsertCodelayerStateEffectProcedure,
	},
	foldSessionEvents: {
		append: appendFoldSessionEventProcedure,
		list: listFoldSessionEventsProcedure,
	},
	artifacts: {
		upsert: upsertArtifactProcedure,
		downloadUrl: getDaemonDownloadUrlProcedure,
		createUpload: daemonCreateUploadProcedure,
	},
	settings: {
		get: daemonGetSettingsEffectProcedure,
	},
	contextShards: {
		listEnabled: daemonListEnabledContextShardsProcedure,
	},
	sync: {
		sessions: syncDaemonSessionsProcedure,
		approvals: syncDaemonApprovalsProcedure,
		tasks: syncDaemonTasksProcedure,
		artifacts: syncDaemonArtifactsProcedure,
		taskWorkspaceSetupForHost: syncDaemonTaskWorkspaceSetupForHostProcedure,
	},
	integrations: {
		github: {
			syncArtifactBacklink: syncGitHubArtifactBacklinkProcedure,
		},
		jira: {
			createRemoteLink: createJiraRemoteLinkProcedure,
		},
		linear: {
			updateIssueStatus: updateLinearIssueStatusProcedure,
			createAttachment: createLinearAttachmentProcedure,
		},
	},
})
