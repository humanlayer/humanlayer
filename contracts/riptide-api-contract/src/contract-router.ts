import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract'

import { discoverWorkspaceAgentCommandsContract } from './api/agent-commands/discover-workspace'
import { generateTitleContract } from './api/ai/generate-title'
import { resolveApprovalContract } from './api/approvals/resolve'
import { createUploadArtifactContract } from './api/artifacts/create-upload'
import { getArtifactContract } from './api/artifacts/get'
import { listArtifactsContract } from './api/artifacts/list'
import { updateArtifactDeletionStatusContract } from './api/artifacts/update-deletion-status'
import { upsertApiArtifactContract } from './api/artifacts/upsert'
import { getArtifactVersionContract, listArtifactVersionsContract } from './api/artifacts/versions'
import { archiveAccessRequestContract } from './api/auth/admin/access-requests/archive'
import { listAccessRequestsContract } from './api/auth/admin/access-requests/list'
import { unreadCountContract } from './api/auth/admin/access-requests/unread-count'
import { billingInfoContract } from './api/auth/admin/billing-info'
import { createAdminInvitationContract } from './api/auth/admin/invitations-create'
import { listAdminInvitationsContract } from './api/auth/admin/invitations-list'
import { revokeAdminInvitationContract } from './api/auth/admin/invitations-revoke'
import { addDomainContract } from './api/auth/admin/organizations-add-domain'
import { generatePortalLinkContract } from './api/auth/admin/organizations-generate-portal-link'
import { removeDomainContract } from './api/auth/admin/organizations-remove-domain'
import { getOrgSettingsContract } from './api/auth/admin/organizations-settings-get'
import { setOrgSettingsContract } from './api/auth/admin/organizations-settings-set'
import { deactivateAdminUserContract } from './api/auth/admin/users-deactivate'
import { listAdminUsersContract } from './api/auth/admin/users-list'
import { reactivateAdminUserContract } from './api/auth/admin/users-reactivate'
import { removeAdminUserContract } from './api/auth/admin/users-remove'
import { setAdminUserMetricsAdvancedContract } from './api/auth/admin/users-set-metrics-advanced'
import { updateAdminUserRoleContract } from './api/auth/admin/users-update-role'
import { createLaunchTokenContract } from './api/auth/daemon/launch-token-create'
import { createDaemonTokenProcedureContract } from './api/auth/daemon/token-create'
import { exchangeDaemonTokenContract } from './api/auth/daemon/token-exchange'
import { getCurrentOrganizationContract } from './api/auth/organizations/get-current'
import { refreshTokenContract } from './api/auth/token-refresh'
import { getUserInfoContract } from './api/auth/user/info'
import { acceptUserInvitationContract } from './api/auth/user/invitations-accept'
import { listUserInvitationsContract } from './api/auth/user/invitations-list'
import { createOrganizationContract } from './api/auth/user/organizations-create'
import { listUserOrganizationsContract } from './api/auth/user/organizations-list'
import {
	createPersonalAccessTokenContract,
	listPersonalAccessTokensContract,
	revokePersonalAccessTokenContract,
} from './api/auth/user/personal-access-tokens'
import { getUserSettingsContract } from './api/auth/user/settings-get'
import { updateUserSettingsContract } from './api/auth/user/settings-update'
import { automationRunPrepareContract } from './api/automation/run-prepare'
import { applyPromotionCodeContract } from './api/billing/apply-promotion-code'
import { createCheckoutSessionContract } from './api/billing/create-checkout-session'
import { createPortalSessionContract } from './api/billing/create-portal-session'
import { downgradeToStarterContract } from './api/billing/downgrade-to-starter'
import { finalizeUpgradeContract } from './api/billing/finalize-upgrade'
import { resyncSeatsContract } from './api/billing/resync-seats'
import { startUpgradeContract } from './api/billing/start-upgrade'
import { syncCheckoutSessionContract } from './api/billing/sync-checkout-session'
import { createCommentContract } from './api/comments/create'
import { deleteCommentContract } from './api/comments/delete'
import { editCommentContract } from './api/comments/edit'
import { getCommentsContract as getApiCommentsContract } from './api/comments/get'
import { publicCommentGuestIdentityContract } from './api/comments/public-comment-guest-identity'
import { replyCommentContract as replyApiCommentContract } from './api/comments/reply'
import { resolveCommentContract } from './api/comments/resolve'
import { resolveAllCommentsContract } from './api/comments/resolve-all'
import { resolveBatchCommentsContract } from './api/comments/resolve-batch'
import { updateCommentContract as updateApiCommentContract } from './api/comments/update'
import { listContextShardsContract } from './api/context-shards/list'
import { restoreContextShardContract } from './api/context-shards/restore'
import { updateContextShardPreferenceContract } from './api/context-shards/update-preference'
import { createDiffCommentContract } from './api/diff-comments/create'
import { deleteDiffCommentContract } from './api/diff-comments/delete'
import { editDiffCommentContract } from './api/diff-comments/edit'
import { replyDiffCommentContract } from './api/diff-comments/reply'
import { resolveDiffCommentContract } from './api/diff-comments/resolve'
import { resolveBatchDiffCommentsContract } from './api/diff-comments/resolve-batch'
import { durableStreamsContract } from './api/durable-streams'
import { listHostAliasesContract } from './api/hosts/alias-list'
import { upsertHostAliasContract } from './api/hosts/alias-upsert'
import { deleteHostContract } from './api/hosts/delete'
import { requestHostUpdateContract } from './api/hosts/update-request'
import { createGitHubInstallUrlContract } from './api/integrations/github/create-install-url'
import { disconnectGitHubContract } from './api/integrations/github/disconnect'
import { getGitHubConnectionContract } from './api/integrations/github/get-connection'
import { getGitHubIssuePreviewContract } from './api/integrations/github/get-issue-preview'
import { getGitHubStatusContract } from './api/integrations/github/get-status'
import { listGitHubConnectionsContract } from './api/integrations/github/list-connections'
import { listGitHubRepositoriesContract } from './api/integrations/github/list-repositories'
import { ensurePullRequestStreamContract } from './api/integrations/github/pull-requests/ensure-stream'
import { listPullRequestBranchesContract } from './api/integrations/github/pull-requests/list-branches'
import { mutatePullRequestContract } from './api/integrations/github/pull-requests/mutate'
import { refreshGitHubConnectionContract } from './api/integrations/github/refresh-connection'
import { createJiraInstallUrlContract } from './api/integrations/jira/create-install-url'
import { disconnectJiraContract } from './api/integrations/jira/disconnect'
import { getJiraIssueContract } from './api/integrations/jira/get-issue'
import { getJiraStatusContract } from './api/integrations/jira/get-status'
import { createLinearInstallUrlContract } from './api/integrations/linear/create-install-url'
import { disconnectLinearContract } from './api/integrations/linear/disconnect'
import { getLinearIssueContract } from './api/integrations/linear/get-issue'
import { getLinearIssueMetadataContract } from './api/integrations/linear/get-issue-metadata'
import { getLinearStatusContract } from './api/integrations/linear/get-status'
import { createSlackAutomationContract } from './api/integrations/slack/create-automation'
import { createSlackInstallUrlContract } from './api/integrations/slack/create-install-url'
import { deleteSlackAutomationContract } from './api/integrations/slack/delete-automation'
import { disconnectSlackContract } from './api/integrations/slack/disconnect'
import { getSlackStatusContract } from './api/integrations/slack/get-status'
import { listSlackAutomationsContract } from './api/integrations/slack/list-automations'
import { listSlackChannelsContract } from './api/integrations/slack/list-channels'
import { updateSlackAutomationContract } from './api/integrations/slack/update-automation'
import {
	activeUsersCollaborationInboundContract,
	activeUsersCollaborationOutboundContract,
	activeUsersCommentsContract,
	activeUsersSessionsContract,
} from './api/metrics/activeUsersCharts'
import { agentCommitsByRepoContract } from './api/metrics/agentCommitsByRepo'
import { costPerKlocByModelContract } from './api/metrics/costPerKlocByModel'
import { dailyActiveUsersContract } from './api/metrics/dailyActiveUsers'
import { modelSpendTrendContract } from './api/metrics/modelSpendTrend'
import { modeSpendTrendContract } from './api/metrics/modeSpendTrend'
import { mostSessionsContract } from './api/metrics/mostSessions'
import { rangeOverviewContract } from './api/metrics/rangeOverview'
import { scatterFilterOptionsContract } from './api/metrics/scatterFilterOptions'
import { sessionsPerDayContract } from './api/metrics/sessionsPerDay'
import { sessionsPerWeekContract } from './api/metrics/sessionsPerWeek'
import { stageSpendTrendContract } from './api/metrics/stageSpendTrend'
import { taskFanOutContract } from './api/metrics/taskFanOut'
import { tokenUseByTaskContract } from './api/metrics/tokenUseByTask'
import { unitCostTrendContract } from './api/metrics/unitCostTrend'
import { usageByModelContract } from './api/metrics/usageByModel'
import { usageTrendContract } from './api/metrics/usageTrend'
import { userModeSpendContract } from './api/metrics/userModeSpend'
import { usersScatterContract } from './api/metrics/usersScatter'
import { userStageSpendContract } from './api/metrics/userStageSpend'
import { weeklyActiveUsersContract } from './api/metrics/weeklyActiveUsers'
import { listActiveOrgMembersContract, listOrgMembersContract } from './api/org/members-list'
import { getProjectWorkspaceStatusContract } from './api/project-workspaces/get-status'
import {
	getProjectWorkspaceRepositorySourcesContract,
	recoverProjectWorkspaceRepositorySourceContract,
	upsertProjectWorkspaceRepositorySourcesContract,
} from './api/project-workspaces/repository-sources'
import { retryProjectWorkspaceRepositorySetupContract } from './api/project-workspaces/retry-repository-setup'
import { skipProjectWorkspaceRepositorySetupStepContract } from './api/project-workspaces/skip-repository-setup-step'
import { archiveProjectV2Contract } from './api/projects-v2/archive'
import { createProjectV2Contract } from './api/projects-v2/create'
import { getProjectV2Contract } from './api/projects-v2/get'
import { listProjectsV2Contract } from './api/projects-v2/list'
import { upsertProjectV2LocationContract } from './api/projects-v2/location-upsert'
import {
	getProjectV2RepositorySourcesContract,
	upsertProjectV2RepositorySourcesContract,
} from './api/projects-v2/repository-sources'
import { updateProjectV2Contract } from './api/projects-v2/update'
import {
	cancelProviderLoginContract,
	createProviderLoginContract,
	listProviderLoginsContract,
	submitProviderLoginCodeContract,
} from './api/provider-login'
import { createAccessRequestContract } from './api/public/access-requests/create'
import { sharedArtifactCommentAuthorsContract } from './api/public/artifacts/comment-authors'
import { createPublicArtifactCommentContract } from './api/public/artifacts/create-comment'
import { sharedArtifactDownloadUrlContract } from './api/public/artifacts/download-url'
import { artifactInfoContract } from './api/public/artifacts/info'
import { resolveSharedArtifactContract } from './api/public/artifacts/resolve'
import { undoPublicArtifactCommentContract } from './api/public/artifacts/undo-comment'
import { continueSessionContract } from './api/sessions/continue'
import { createSessionContract } from './api/sessions/create'
import { listSessionEventsContract } from './api/sessions/events/list'
import { forkSessionContract, forkSessionV2Contract } from './api/sessions/fork'
import { handoffSessionContract } from './api/sessions/handoff'
import { interruptSessionContract } from './api/sessions/interrupt'
import { launchSessionContract } from './api/sessions/launch'
import { listSessionsContract } from './api/sessions/list'
import { updateMultiplayerPromptingContract } from './api/sessions/multiplayer-prompting/update'
import {
	createQueuedMessageContract,
	deleteQueuedMessageContract,
	sendNowQueuedMessageContract,
	updateQueuedMessageContract,
} from './api/sessions/queued-messages'
import { updateSessionApiContract } from './api/sessions/update'
import { updateSessionStatusContract } from './api/sessions/update-status'
import { continueSessionV2Contract } from './api/sessions/v2/continue'
import { createSessionV2Contract } from './api/sessions/v2/create'
import { updateArtifactSharingContract } from './api/sharing/artifact/update'
import { updateOrgSharingContract } from './api/sharing/organization/update'
import { updateUserSharingContract } from './api/sharing/user/update'
import { syncApprovalsContract } from './api/sync/approvals'
import { syncArtifactCommentsContract } from './api/sync/artifact-comments'
import { syncArtifactsContract } from './api/sync/artifacts'
import { syncArtifactsMetadataContract } from './api/sync/artifacts-metadata'
import { syncConversationEventsContract } from './api/sync/conversation-events'
import { syncOnlineHostsContract } from './api/sync/online-hosts'
import { syncQueuedMessagesContract } from './api/sync/queued-messages'
import { syncSessionsContract } from './api/sync/sessions'
import { syncTaskOrganizationAclsContract } from './api/sync/task-organization-acls'
import { syncTaskUserAclsContract } from './api/sync/task-user-acls'
import { syncTaskUserSettingsContract } from './api/sync/task-user-settings'
import { syncTasksContract } from './api/sync/tasks'
import { syncV2AgentSlashCommandsContract } from './api/sync/v2/agent-slash-commands'
import { syncV2ApprovalsContract } from './api/sync/v2/approvals'
import { syncV2ArtifactCommentsContract } from './api/sync/v2/artifact-comments'
import { syncV2ArtifactsContract } from './api/sync/v2/artifacts'
import { syncV2ArtifactsMetadataContract } from './api/sync/v2/artifacts-metadata'
import { syncV2ConversationEventsContract } from './api/sync/v2/conversation-events'
import { syncV2DiffCommentsContract } from './api/sync/v2/diff-comments'
import { syncV2OnlineHostsContract } from './api/sync/v2/online-hosts'
import { syncV2ProviderLoginRequestsContract } from './api/sync/v2/provider-login-requests'
import { syncV2QueuedMessagesContract } from './api/sync/v2/queued-messages'
import { syncV2SessionsContract } from './api/sync/v2/sessions'
import { syncV2TaskOrganizationAclsContract } from './api/sync/v2/task-organization-acls'
import { syncV2TaskUserAclsContract } from './api/sync/v2/task-user-acls'
import { syncV2TaskUserSettingsContract } from './api/sync/v2/task-user-settings'
import { syncV2TaskWorkspaceSetupForHostContract } from './api/sync/v2/task-workspace-setup-for-host'
import { syncV2TasksContract } from './api/sync/v2/tasks'
import { upsertTaskUserSettingsContract } from './api/task-user-settings/upsert'
import { archiveTaskContract } from './api/tasks/archive'
import { createTaskContract } from './api/tasks/create'
import { createTaskDraftContract } from './api/tasks/createDraft'
import { launchTaskDraftContract } from './api/tasks/launch-draft'
import { listTasksContract } from './api/tasks/list'
import { reassignTaskOwnerContract } from './api/tasks/reassign-owner'
import { saveTaskDraftContract } from './api/tasks/saveDraft'
import { updateTaskContract } from './api/tasks/update'
import { createTaskV2Contract } from './api/tasks/v2/create'
import { createUploadContract } from './api/uploads/create'
import { getDownloadUrlContract } from './api/uploads/download-url'
import { getPresignedUrlContract } from './api/uploads/get-presigned-url'
import { upsertTextArtifactContract } from './api/uploads/upsert-text'
import { getPresignedUrlV2Contract } from './api/uploads/v2/get-presigned-url'
import { retryWorkspaceSetupStepContract } from './api/workspace-setup/retry-step'
import { skipWorkspaceSetupStepContract } from './api/workspace-setup/skip-step'
import { updateWorkspaceSetupRepositoryDirectoryContract } from './api/workspace-setup/update-repository-directory'
import { reportAgentCommandsContract } from './daemon/agent-commands/report'
import { researchContract } from './daemon/agents/research'
import { createApprovalContract } from './daemon/approvals/create'
import { daemonCreateUploadContract } from './daemon/artifacts/create-upload'
import { getDaemonDownloadUrlContract } from './daemon/artifacts/download-url'
import { upsertArtifactContract } from './daemon/artifacts/upsert'
import {
	getCodelayerStateContract,
	getCodelayerStateSnapshotContract,
	upsertCodelayerStateContract,
} from './daemon/codelayer-state'
import { getCommentsContract } from './daemon/comments/get'
import { replyCommentContract } from './daemon/comments/reply'
import { updateCommentContract } from './daemon/comments/update'
import { recordObservedCommitsContract } from './daemon/commits/record-observed'
import { getCommitWatermarksContract, setCommitWatermarkContract } from './daemon/commits/watermark'
import { listEnabledContextShardsContract } from './daemon/context-shards/list-enabled'
import { getDiffCommentsContract } from './daemon/diff-comments/get'
import { replyToDiffCommentContract } from './daemon/diff-comments/reply'
import { updateDiffCommentsContract } from './daemon/diff-comments/update'
import { createEventContract } from './daemon/events/create'
import { appendFoldSessionEventContract, listFoldSessionEventsContract } from './daemon/fold-session-events'
import { heartbeatContract } from './daemon/heartbeat'
import { shutdownContract } from './daemon/hosts/shutdown'
import { syncGitHubArtifactBacklinkContract } from './daemon/integrations/github/sync-artifact-backlink'
import { createJiraRemoteLinkContract } from './daemon/integrations/jira/create-remote-link'
import { createLinearAttachmentContract } from './daemon/integrations/linear/create-attachment'
import { updateLinearIssueStatusContract } from './daemon/integrations/linear/update-issue-status'
import { getWorkspaceRepositoryStatusContract } from './daemon/project-workspaces/get-repository-status'
import { getSessionWorkspaceSetupContract } from './daemon/project-workspaces/get-session-workspace-setup'
import { getTaskWorkspaceContextContract } from './daemon/project-workspaces/get-task-workspace-context'
import { reportWorkspaceRepositoryResultContract } from './daemon/project-workspaces/report-repository-result'
import { updateDaemonProviderLoginContract } from './daemon/provider-login/update'
import { listOpenPullRequestsForHostContract } from './daemon/pull-requests/list-open-for-host'
import { refreshPullRequestStatusContract } from './daemon/pull-requests/refresh-status'
import { recordCommitsContract } from './daemon/sessions/commits/record'
import { ensureStreamHydratedContract } from './daemon/sessions/ensure-stream-hydrated'
import { upsertSessionPullRequestContract } from './daemon/sessions/pull-requests/upsert'
import { reportSessionRepositoriesContract } from './daemon/sessions/repositories/report'
import { updateSessionContract } from './daemon/sessions/update'
import { recordSessionUsageContract } from './daemon/sessions/usage-record'
import { daemonGetSettingsContract } from './daemon/settings/get'
import { syncDaemonApprovalsContract } from './daemon/sync/approvals'
import { syncDaemonArtifactsContract } from './daemon/sync/artifacts'
import { syncDaemonSessionsContract } from './daemon/sync/sessions'
import { syncDaemonTaskWorkspaceSetupForHostContract } from './daemon/sync/task-workspace-setup-for-host'
import { syncDaemonTasksContract } from './daemon/sync/tasks'
import { setGithubIdentityContract } from './daemon/users/set-github-identity'
import { updateDaemonWorkspaceSetupContract } from './daemon/workspace-setup/update'

// Assemble the contract router in hierarchical structure
export const RiptideApiContract = {
	public: {
		accessRequests: {
			create: createAccessRequestContract,
		},
		artifacts: {
			info: artifactInfoContract,
			downloadUrl: sharedArtifactDownloadUrlContract,
			resolve: resolveSharedArtifactContract,
			commentAuthors: sharedArtifactCommentAuthorsContract,
			createComment: createPublicArtifactCommentContract,
			undoComment: undoPublicArtifactCommentContract,
		},
	},
	metrics: {
		activeUsersCollaborationInbound: activeUsersCollaborationInboundContract,
		activeUsersCollaborationOutbound: activeUsersCollaborationOutboundContract,
		activeUsersComments: activeUsersCommentsContract,
		activeUsersSessions: activeUsersSessionsContract,
		agentCommitsByRepo: agentCommitsByRepoContract,
		costPerKlocByModel: costPerKlocByModelContract,
		dailyActiveUsers: dailyActiveUsersContract,
		modeSpendTrend: modeSpendTrendContract,
		modelSpendTrend: modelSpendTrendContract,
		mostSessions: mostSessionsContract,
		rangeOverview: rangeOverviewContract,
		scatterFilterOptions: scatterFilterOptionsContract,
		sessionsPerDay: sessionsPerDayContract,
		sessionsPerWeek: sessionsPerWeekContract,
		stageSpendTrend: stageSpendTrendContract,
		taskFanOut: taskFanOutContract,
		tokenUseByTask: tokenUseByTaskContract,
		unitCostTrend: unitCostTrendContract,
		usageByModel: usageByModelContract,
		usageTrend: usageTrendContract,
		usersScatter: usersScatterContract,
		userStageSpend: userStageSpendContract,
		userModeSpend: userModeSpendContract,
		weeklyActiveUsers: weeklyActiveUsersContract,
	},
	automation: {
		run: {
			prepare: automationRunPrepareContract,
		},
	},
	auth: {
		user: {
			info: getUserInfoContract,
			personalAccessTokens: {
				create: createPersonalAccessTokenContract,
				list: listPersonalAccessTokensContract,
				revoke: revokePersonalAccessTokenContract,
			},
			settings: {
				get: getUserSettingsContract,
				update: updateUserSettingsContract,
			},
			organizations: {
				list: listUserOrganizationsContract,
				create: createOrganizationContract,
			},
			invitations: {
				list: listUserInvitationsContract,
				accept: acceptUserInvitationContract,
			},
		},
		organizations: {
			getCurrent: getCurrentOrganizationContract,
		},

		admin: {
			accessRequests: {
				list: listAccessRequestsContract,
				unreadCount: unreadCountContract,
				archive: archiveAccessRequestContract,
			},
			invitations: {
				list: listAdminInvitationsContract,
				create: createAdminInvitationContract,
				revoke: revokeAdminInvitationContract,
			},
			users: {
				list: listAdminUsersContract,
				updateRole: updateAdminUserRoleContract,
				remove: removeAdminUserContract,
				deactivate: deactivateAdminUserContract,
				reactivate: reactivateAdminUserContract,
				setMetricsAdvancedEnabled: setAdminUserMetricsAdvancedContract,
			},
			billing: {
				info: billingInfoContract,
			},
			organizations: {
				addDomain: addDomainContract,
				removeDomain: removeDomainContract,
				generatePortalLink: generatePortalLinkContract,
				settings: {
					get: getOrgSettingsContract,
					set: setOrgSettingsContract,
				},
			},
		},
		token: {
			refresh: refreshTokenContract,
		},
		daemon: {
			token: {
				create: createDaemonTokenProcedureContract,
				exchange: exchangeDaemonTokenContract,
			},
			launchToken: {
				create: createLaunchTokenContract,
			},
		},
	},
	sessions: {
		create: createSessionContract,
		fork: forkSessionContract,
		handoff: handoffSessionContract,
		v2: {
			fork: forkSessionV2Contract,
			continue: continueSessionV2Contract,
			create: createSessionV2Contract,
		},
		launch: launchSessionContract,
		update: updateSessionApiContract,
		updateStatus: updateSessionStatusContract,
		continue: continueSessionContract,
		interrupt: interruptSessionContract,
		list: listSessionsContract,
		multiplayerPrompting: { update: updateMultiplayerPromptingContract },
		events: {
			list: listSessionEventsContract,
		},
		queuedMessages: {
			create: createQueuedMessageContract,
			update: updateQueuedMessageContract,
			delete: deleteQueuedMessageContract,
			sendNow: sendNowQueuedMessageContract,
		},
	},
	tasks: {
		create: createTaskContract,
		createDraft: createTaskDraftContract,
		launchDraft: launchTaskDraftContract,
		saveDraft: saveTaskDraftContract,
		update: updateTaskContract,
		reassignOwner: reassignTaskOwnerContract,
		archive: archiveTaskContract,
		list: listTasksContract,
		v2: {
			create: createTaskV2Contract,
		},
	},
	projects: {
		v2: {
			list: listProjectsV2Contract,
			get: getProjectV2Contract,
			create: createProjectV2Contract,
			update: updateProjectV2Contract,
			archive: archiveProjectV2Contract,
			locations: { upsert: upsertProjectV2LocationContract },
			repositorySources: {
				get: getProjectV2RepositorySourcesContract,
				upsert: upsertProjectV2RepositorySourcesContract,
			},
		},
	},
	projectWorkspaces: {
		getStatus: getProjectWorkspaceStatusContract,
		repositorySources: {
			get: getProjectWorkspaceRepositorySourcesContract,
			upsert: upsertProjectWorkspaceRepositorySourcesContract,
			recover: recoverProjectWorkspaceRepositorySourceContract,
		},
		retryRepositorySetup: retryProjectWorkspaceRepositorySetupContract,
		skipRepositorySetupStep: skipProjectWorkspaceRepositorySetupStepContract,
	},
	organization: {
		members: {
			list: listOrgMembersContract,
			listActive: listActiveOrgMembersContract,
		},
	},
	sharing: {
		organization: {
			update: updateOrgSharingContract,
		},
		user: {
			update: updateUserSharingContract,
		},
		artifact: {
			update: updateArtifactSharingContract,
		},
	},
	approvals: {
		resolve: resolveApprovalContract,
	},
	durableStreams: durableStreamsContract,
	comments: {
		get: getApiCommentsContract,
		update: updateApiCommentContract,
		reply: replyApiCommentContract,
		create: createCommentContract,
		resolve: resolveCommentContract,
		resolveAll: resolveAllCommentsContract,
		resolveBatch: resolveBatchCommentsContract,
		delete: deleteCommentContract,
		edit: editCommentContract,
		publicCommentGuestIdentity: publicCommentGuestIdentityContract,
	},
	diffComments: {
		create: createDiffCommentContract,
		reply: replyDiffCommentContract,
		edit: editDiffCommentContract,
		delete: deleteDiffCommentContract,
		resolve: resolveDiffCommentContract,
		resolveBatch: resolveBatchDiffCommentsContract,
	},
	billing: {
		applyPromotionCode: applyPromotionCodeContract,
		createCheckoutSession: createCheckoutSessionContract,
		createPortalSession: createPortalSessionContract,
		downgradeToStarter: downgradeToStarterContract,
		finalizeUpgrade: finalizeUpgradeContract,
		resyncSeats: resyncSeatsContract,
		startUpgrade: startUpgradeContract,
		syncCheckoutSession: syncCheckoutSessionContract,
	},
	artifacts: {
		list: listArtifactsContract,
		get: getArtifactContract,
		versions: {
			list: listArtifactVersionsContract,
			get: getArtifactVersionContract,
		},
		upsert: upsertApiArtifactContract,
		createUpload: createUploadArtifactContract,
		updateDeletionStatus: updateArtifactDeletionStatusContract,
	},
	taskUserSettings: {
		upsert: upsertTaskUserSettingsContract,
	},
	contextShards: {
		list: listContextShardsContract,
		updatePreference: updateContextShardPreferenceContract,
		restore: restoreContextShardContract,
	},
	workspaceSetup: {
		retryStep: retryWorkspaceSetupStepContract,
		skipStep: skipWorkspaceSetupStepContract,
		updateRepositoryDirectory: updateWorkspaceSetupRepositoryDirectoryContract,
	},
	providerLogin: {
		create: createProviderLoginContract,
		submitCode: submitProviderLoginCodeContract,
		cancel: cancelProviderLoginContract,
		list: listProviderLoginsContract,
	},
	agentCommands: {
		discoverWorkspace: discoverWorkspaceAgentCommandsContract,
	},
	ai: {
		generateTitle: generateTitleContract,
	},
	sync: {
		sessions: syncSessionsContract,
		tasks: syncTasksContract,
		conversationEvents: syncConversationEventsContract,
		approvals: syncApprovalsContract,
		artifactComments: syncArtifactCommentsContract,
		artifacts: syncArtifactsContract,
		artifactsMetadata: syncArtifactsMetadataContract,
		queuedMessages: syncQueuedMessagesContract,
		v2: {
			sessions: syncV2SessionsContract,
			tasks: syncV2TasksContract,
			conversationEvents: syncV2ConversationEventsContract,
			approvals: syncV2ApprovalsContract,
			artifactComments: syncV2ArtifactCommentsContract,
			diffComments: syncV2DiffCommentsContract,
			artifacts: syncV2ArtifactsContract,
			artifactsMetadata: syncV2ArtifactsMetadataContract,
			queuedMessages: syncV2QueuedMessagesContract,
			taskOrganizationAcls: syncV2TaskOrganizationAclsContract,
			taskUserAcls: syncV2TaskUserAclsContract,
			taskUserSettings: syncV2TaskUserSettingsContract,
			taskWorkspaceSetupForHost: syncV2TaskWorkspaceSetupForHostContract,
			onlineHosts: syncV2OnlineHostsContract,
			agentSlashCommands: syncV2AgentSlashCommandsContract,
			providerLoginRequests: syncV2ProviderLoginRequestsContract,
		},
		onlineHosts: syncOnlineHostsContract,
		taskOrganizationAcls: syncTaskOrganizationAclsContract,
		taskUserAcls: syncTaskUserAclsContract,
		taskUserSettings: syncTaskUserSettingsContract,
	},
	uploads: {
		create: createUploadContract,
		getPresignedUrl: getPresignedUrlContract,
		downloadUrl: getDownloadUrlContract,
		upsertText: upsertTextArtifactContract,
		v2: {
			getPresignedUrl: getPresignedUrlV2Contract,
		},
	},
	integrations: {
		github: {
			createInstallUrl: createGitHubInstallUrlContract,
			getStatus: getGitHubStatusContract,
			listConnections: listGitHubConnectionsContract,
			getConnection: getGitHubConnectionContract,
			getIssuePreview: getGitHubIssuePreviewContract,
			listRepositories: listGitHubRepositoriesContract,
			refreshConnection: refreshGitHubConnectionContract,
			disconnect: disconnectGitHubContract,
			pullRequests: {
				ensureStream: ensurePullRequestStreamContract,
				listPullRequestBranches: listPullRequestBranchesContract,
				mutate: mutatePullRequestContract,
			},
		},
		jira: {
			createInstallUrl: createJiraInstallUrlContract,
			getStatus: getJiraStatusContract,
			getIssue: getJiraIssueContract,
			disconnect: disconnectJiraContract,
		},
		linear: {
			createInstallUrl: createLinearInstallUrlContract,
			getStatus: getLinearStatusContract,
			getIssue: getLinearIssueContract,
			getIssueMetadata: getLinearIssueMetadataContract,
			disconnect: disconnectLinearContract,
		},
		slack: {
			createInstallUrl: createSlackInstallUrlContract,
			getStatus: getSlackStatusContract,
			disconnect: disconnectSlackContract,
			listChannels: listSlackChannelsContract,
			listAutomations: listSlackAutomationsContract,
			createAutomation: createSlackAutomationContract,
			updateAutomation: updateSlackAutomationContract,
			deleteAutomation: deleteSlackAutomationContract,
		},
	},
	hosts: {
		delete: deleteHostContract,
		alias: {
			upsert: upsertHostAliasContract,
			list: listHostAliasesContract,
		},
		update: {
			request: requestHostUpdateContract,
		},
	},
}

export const RiptideDaemonApiContract = {
	hosts: {
		heartbeat: heartbeatContract,
		shutdown: shutdownContract,
	},
	comments: {
		get: getCommentsContract,
		update: updateCommentContract,
		reply: replyCommentContract,
	},
	diffComments: {
		get: getDiffCommentsContract,
		update: updateDiffCommentsContract,
		reply: replyToDiffCommentContract,
	},
	sessions: {
		events: {
			create: createEventContract,
		},
		commits: {
			record: recordCommitsContract,
		},
		usage: {
			record: recordSessionUsageContract,
		},
		pullRequests: {
			upsert: upsertSessionPullRequestContract,
		},
		repositories: {
			report: reportSessionRepositoriesContract,
		},
		update: updateSessionContract,
		ensureStreamHydrated: ensureStreamHydratedContract,
	},
	// Host-scoped commit ledger (sibling of sessions): the HEAD-watch records every
	// observed commit already tagged with an attribution tier, and tracks a
	// per-(host, repo) resume watermark. NOT nested under a session — a commit may
	// belong to no session (a human commit).
	commits: {
		recordObserved: recordObservedCommitsContract,
		watermark: {
			get: getCommitWatermarksContract,
			set: setCommitWatermarkContract,
		},
	},
	pullRequests: {
		listOpenForHost: listOpenPullRequestsForHostContract,
		refreshStatus: refreshPullRequestStatusContract,
	},
	projectWorkspaces: {
		getRepositoryStatus: getWorkspaceRepositoryStatusContract,
		getSessionWorkspaceSetup: getSessionWorkspaceSetupContract,
		getTaskWorkspaceContext: getTaskWorkspaceContextContract,
		reportRepositoryResult: reportWorkspaceRepositoryResultContract,
	},
	users: {
		setGithubIdentity: setGithubIdentityContract,
	},
	approvals: {
		create: createApprovalContract,
	},
	agents: {
		research: researchContract,
	},
	agentCommands: {
		report: reportAgentCommandsContract,
	},
	codelayerState: {
		get: getCodelayerStateContract,
		snapshot: {
			get: getCodelayerStateSnapshotContract,
		},
		upsert: upsertCodelayerStateContract,
	},
	foldSessionEvents: {
		append: appendFoldSessionEventContract,
		list: listFoldSessionEventsContract,
	},
	artifacts: {
		upsert: upsertArtifactContract,
		downloadUrl: getDaemonDownloadUrlContract,
		createUpload: daemonCreateUploadContract,
	},
	settings: {
		get: daemonGetSettingsContract,
	},
	contextShards: {
		listEnabled: listEnabledContextShardsContract,
	},
	sync: {
		sessions: syncDaemonSessionsContract,
		approvals: syncDaemonApprovalsContract,
		tasks: syncDaemonTasksContract,
		artifacts: syncDaemonArtifactsContract,
		taskWorkspaceSetupForHost: syncDaemonTaskWorkspaceSetupForHostContract,
	},
	workspaceSetup: { update: updateDaemonWorkspaceSetupContract },
	providerLogin: { update: updateDaemonProviderLoginContract },
	integrations: {
		github: {
			syncArtifactBacklink: syncGitHubArtifactBacklinkContract,
		},
		jira: {
			createRemoteLink: createJiraRemoteLinkContract,
		},
		linear: {
			updateIssueStatus: updateLinearIssueStatusContract,
			createAttachment: createLinearAttachmentContract,
		},
	},
}

// Export type inference utilities
export type RiptideApiInputs = InferContractRouterInputs<typeof RiptideApiContract>
export type RiptideApiOutputs = InferContractRouterOutputs<typeof RiptideApiContract>

export type RiptideDaemonApiInputs = InferContractRouterInputs<typeof RiptideDaemonApiContract>
export type RiptideDaemonApiOutputs = InferContractRouterOutputs<typeof RiptideApiContract>
