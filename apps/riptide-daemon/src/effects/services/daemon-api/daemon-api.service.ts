import type { LogEntry } from '@humanlayer/fold-core'
import { Context, type Effect } from 'effect'

import type { ORPCClient } from '@/agents/claudecode/types'

import type {
	DaemonAgentCommandsReportError,
	DaemonConversationEventCreateError,
	DaemonConversationStreamHydrationError,
	DaemonContextShardsListError,
	DaemonFoldSessionEventAppendError,
	DaemonFoldSessionEventListError,
	DaemonApprovalCreateError,
	DaemonSessionUpdateError,
	DaemonSettingsGetError,
	DaemonTaskCapabilityError,
	DaemonTaskWorkspaceContextError,
	DaemonTaskWorkspaceContextNotFound,
	DaemonUsageRecordError,
	DaemonWorkspaceRepositoryApiError,
	DaemonWorkspaceRepositoryStatusUnavailable,
	DaemonWorkspaceRepositoryStatusChanged,
	DaemonWorkspaceSessionSetupError,
	DaemonWorkspaceSessionSetupNotFound,
} from './daemon-api.errors'

type SettingsGet = ORPCClient['settings']['get']
type ContextShardsListEnabled = ORPCClient['contextShards']['listEnabled']
type SessionUpdate = ORPCClient['sessions']['update']
type ConversationEventCreate = ORPCClient['sessions']['events']['create']
export type CreateConversationEventInput = Parameters<ConversationEventCreate>[0]
type UsageRecord = ORPCClient['sessions']['usage']['record']
type EnsureConversationStream = ORPCClient['sessions']['ensureStreamHydrated']
type CommentsGet = ORPCClient['comments']['get']
type CommentsUpdate = ORPCClient['comments']['update']
type CommentsReply = ORPCClient['comments']['reply']
type DiffCommentsGet = ORPCClient['diffComments']['get']
type DiffCommentsUpdate = ORPCClient['diffComments']['update']
type DiffCommentsReply = ORPCClient['diffComments']['reply']
type AgentResearch = ORPCClient['agents']['research']
type LinearAttachmentCreate = ORPCClient['integrations']['linear']['createAttachment']
type JiraRemoteLinkCreate = ORPCClient['integrations']['jira']['createRemoteLink']
type GitHubArtifactBacklinkSync = ORPCClient['integrations']['github']['syncArtifactBacklink']
type ApprovalCreate = ORPCClient['approvals']['create']
type WorkspaceSetupUpdate = ORPCClient['workspaceSetup']['update']
type AgentCommandsReport = ORPCClient['agentCommands']['report']
type ProviderLoginUpdate = ORPCClient['providerLogin']['update']
type FoldSessionEventAppend = ORPCClient['foldSessionEvents']['append']
type FoldSessionEventList = ORPCClient['foldSessionEvents']['list']
type FoldSessionEventEntry = Awaited<ReturnType<FoldSessionEventAppend>>['entry']
type GetWorkspaceRepositoryStatus = ORPCClient['projectWorkspaces']['getRepositoryStatus']
type ReportWorkspaceRepositoryResult = ORPCClient['projectWorkspaces']['reportRepositoryResult']
type GetSessionWorkspaceSetup = ORPCClient['projectWorkspaces']['getSessionWorkspaceSetup']
type GetTaskWorkspaceContext = ORPCClient['projectWorkspaces']['getTaskWorkspaceContext']

export interface AppendFoldSessionEventInput {
	readonly sessionId: string
	readonly entry: LogEntry
}

export interface ListFoldSessionEventsInput {
	readonly sessionId: string
}

export class DaemonApi extends Context.Service<
	DaemonApi,
	{
		readonly getSettings: (
			input: Parameters<SettingsGet>[0],
		) => Effect.Effect<Awaited<ReturnType<SettingsGet>>, DaemonSettingsGetError>
		readonly listEnabledContextShards: (
			input: Parameters<ContextShardsListEnabled>[0],
		) => Effect.Effect<Awaited<ReturnType<ContextShardsListEnabled>>, DaemonContextShardsListError>
		readonly updateSession: (
			input: Parameters<SessionUpdate>[0],
		) => Effect.Effect<Awaited<ReturnType<SessionUpdate>>, DaemonSessionUpdateError>
		readonly updateWorkspaceSetup: (
			input: Parameters<WorkspaceSetupUpdate>[0],
		) => Effect.Effect<Awaited<ReturnType<WorkspaceSetupUpdate>>, DaemonTaskCapabilityError>
		readonly updateProviderLogin: (
			input: Parameters<ProviderLoginUpdate>[0],
		) => Effect.Effect<Awaited<ReturnType<ProviderLoginUpdate>>, DaemonTaskCapabilityError>
		readonly createConversationEvent: (
			input: CreateConversationEventInput,
		) => Effect.Effect<Awaited<ReturnType<ConversationEventCreate>>, DaemonConversationEventCreateError>
		readonly recordUsage: (
			input: Parameters<UsageRecord>[0],
		) => Effect.Effect<Awaited<ReturnType<UsageRecord>>, DaemonUsageRecordError>
		readonly ensureConversationStream: (
			input: Parameters<EnsureConversationStream>[0],
		) => Effect.Effect<Awaited<ReturnType<EnsureConversationStream>>, DaemonConversationStreamHydrationError>
		readonly reportAgentCommands: (
			input: Parameters<AgentCommandsReport>[0],
		) => Effect.Effect<Awaited<ReturnType<AgentCommandsReport>>, DaemonAgentCommandsReportError>
		readonly createApproval: (
			input: Parameters<ApprovalCreate>[0],
		) => Effect.Effect<Awaited<ReturnType<ApprovalCreate>>, DaemonApprovalCreateError>
		readonly appendFoldSessionEvent: (
			input: AppendFoldSessionEventInput,
		) => Effect.Effect<FoldSessionEventEntry, DaemonFoldSessionEventAppendError>
		readonly listFoldSessionEvents: (
			input: ListFoldSessionEventsInput,
		) => Effect.Effect<Awaited<ReturnType<FoldSessionEventList>>['entries'], DaemonFoldSessionEventListError>
		readonly getWorkspaceRepositoryStatus: (
			input: Parameters<GetWorkspaceRepositoryStatus>[0],
		) => Effect.Effect<
			Awaited<ReturnType<GetWorkspaceRepositoryStatus>>['repositoryStatus'],
			DaemonWorkspaceRepositoryApiError | DaemonWorkspaceRepositoryStatusUnavailable
		>
		readonly reportWorkspaceRepositoryResult: (
			input: Parameters<ReportWorkspaceRepositoryResult>[0],
		) => Effect.Effect<
			Awaited<ReturnType<ReportWorkspaceRepositoryResult>>,
			DaemonWorkspaceRepositoryApiError | DaemonWorkspaceRepositoryStatusChanged
		>
		readonly getArtifactComments: (
			input: Parameters<CommentsGet>[0],
		) => Effect.Effect<Awaited<ReturnType<CommentsGet>>, DaemonTaskCapabilityError>
		readonly updateArtifactComments: (
			input: Parameters<CommentsUpdate>[0],
		) => Effect.Effect<Awaited<ReturnType<CommentsUpdate>>, DaemonTaskCapabilityError>
		readonly replyToArtifactComment: (
			input: Parameters<CommentsReply>[0],
		) => Effect.Effect<Awaited<ReturnType<CommentsReply>>, DaemonTaskCapabilityError>
		readonly getDiffComments: (
			input: Parameters<DiffCommentsGet>[0],
		) => Effect.Effect<Awaited<ReturnType<DiffCommentsGet>>, DaemonTaskCapabilityError>
		readonly updateDiffComments: (
			input: Parameters<DiffCommentsUpdate>[0],
		) => Effect.Effect<Awaited<ReturnType<DiffCommentsUpdate>>, DaemonTaskCapabilityError>
		readonly replyToDiffComment: (
			input: Parameters<DiffCommentsReply>[0],
		) => Effect.Effect<Awaited<ReturnType<DiffCommentsReply>>, DaemonTaskCapabilityError>
		readonly researchLibrary: (
			input: Parameters<AgentResearch>[0],
		) => Effect.Effect<Awaited<ReturnType<AgentResearch>>, DaemonTaskCapabilityError>
		readonly createLinearAttachment: (
			input: Parameters<LinearAttachmentCreate>[0],
		) => Effect.Effect<Awaited<ReturnType<LinearAttachmentCreate>>, DaemonTaskCapabilityError>
		readonly createJiraRemoteLink: (
			input: Parameters<JiraRemoteLinkCreate>[0],
		) => Effect.Effect<Awaited<ReturnType<JiraRemoteLinkCreate>>, DaemonTaskCapabilityError>
		readonly syncGitHubArtifactBacklink: (
			input: Parameters<GitHubArtifactBacklinkSync>[0],
		) => Effect.Effect<Awaited<ReturnType<GitHubArtifactBacklinkSync>>, DaemonTaskCapabilityError>
		readonly getSessionWorkspaceSetup: (
			input: Parameters<GetSessionWorkspaceSetup>[0],
		) => Effect.Effect<
			Awaited<ReturnType<GetSessionWorkspaceSetup>>,
			DaemonWorkspaceSessionSetupError | DaemonWorkspaceSessionSetupNotFound
		>
		readonly getTaskWorkspaceContext: (
			input: Parameters<GetTaskWorkspaceContext>[0],
		) => Effect.Effect<
			Awaited<ReturnType<GetTaskWorkspaceContext>>,
			DaemonTaskWorkspaceContextNotFound | DaemonTaskWorkspaceContextError
		>
	}
>()('DaemonApi') {}
