import * as Sentry from '@sentry/bun'
import { Effect, Layer, Option } from 'effect'
import * as Schema from 'effect/Schema'

import type { ORPCClient } from '@/agents/claudecode/types'

import {
	DaemonAgentCommandsReportError,
	DaemonApprovalCreateError,
	DaemonConversationEventCreateError,
	DaemonConversationStreamHydrationError,
	DaemonContextShardsListError,
	DaemonFoldSessionEventAppendError,
	DaemonFoldSessionEventListError,
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
import { DaemonApi } from './daemon-api.service'

const RepositoryStatusChangedEnvelope = Schema.Struct({
	code: Schema.Literal('REPOSITORY_STATUS_CHANGED'),
	data: Schema.Struct({ snapshot: Schema.Unknown }),
})

const NotFoundEnvelope = Schema.Struct({ code: Schema.Literal('NOT_FOUND') })
const RepositoryStatusUnavailableEnvelope = Schema.Struct({
	code: Schema.Literals(['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'BAD_REQUEST']),
})
const isNotFoundResponse = (cause: unknown) => Option.isSome(Schema.decodeUnknownOption(NotFoundEnvelope)(cause))

const reportDaemonApiFailure = <A, E extends { readonly cause: unknown }, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.tapError((error) => Effect.logError('Daemon API request failed', error.cause)),
		Effect.tapError((error) =>
			Effect.sync(() => {
				Sentry.captureException(error.cause, { tags: { error_type: 'daemon_api_request' } })
			}),
		),
	)

export const DaemonApiLive = (client: ORPCClient) =>
	Layer.succeed(DaemonApi, {
		getSettings: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.settings.get(input, { signal }),
					catch: (cause) => new DaemonSettingsGetError({ cause }),
				}),
			),
		listEnabledContextShards: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.contextShards.listEnabled(input, { signal }),
					catch: (cause) => new DaemonContextShardsListError({ cause }),
				}),
			),
		updateSession: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.sessions.update(input, { signal }),
					catch: (cause) => new DaemonSessionUpdateError({ cause }),
				}),
			),
		updateWorkspaceSetup: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.workspaceSetup.update(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		updateProviderLogin: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.providerLogin.update(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		createConversationEvent: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.sessions.events.create(input, { signal }),
					catch: (cause) => new DaemonConversationEventCreateError({ cause }),
				}),
			),
		recordUsage: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.sessions.usage.record(input, { signal }),
					catch: (cause) => new DaemonUsageRecordError({ cause }),
				}),
			),
		ensureConversationStream: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.sessions.ensureStreamHydrated(input, { signal, context: { retry: 1 } }),
					catch: (cause) => new DaemonConversationStreamHydrationError({ cause }),
				}),
			),
		reportAgentCommands: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.agentCommands.report(input, { signal }),
					catch: (cause) => new DaemonAgentCommandsReportError({ cause }),
				}),
			),
		createApproval: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.approvals.create(input, { signal }),
					catch: (cause) => new DaemonApprovalCreateError({ cause }),
				}),
			),
		appendFoldSessionEvent: Effect.fn('daemon.api.fold_session_events.append')((input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) =>
						client.foldSessionEvents.append(
							{
								sessionId: input.sessionId,
								entry: {
									seq: input.entry.seq,
									eventId: input.entry.eventId,
									ts: input.entry.ts,
									event: input.entry,
								},
							},
							{ signal },
						),
					catch: (cause) => new DaemonFoldSessionEventAppendError({ cause }),
				}).pipe(Effect.map(({ entry }) => entry)),
			),
		),
		listFoldSessionEvents: Effect.fn('daemon.api.fold_session_events.list')((input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.foldSessionEvents.list(input, { signal }),
					catch: (cause) => new DaemonFoldSessionEventListError({ cause }),
				}).pipe(Effect.map(({ entries }) => entries)),
			),
		),
		getWorkspaceRepositoryStatus: Effect.fn('daemon.api.project_workspaces.get_repository_status')((input) =>
			Effect.tryPromise({
				try: (signal) => client.projectWorkspaces.getRepositoryStatus(input, { signal }),
				catch: (cause) =>
					Option.match(Schema.decodeUnknownOption(RepositoryStatusUnavailableEnvelope)(cause), {
						onSome: ({ code }) => new DaemonWorkspaceRepositoryStatusUnavailable({ ...input, code }),
						onNone: () => new DaemonWorkspaceRepositoryApiError({ cause }),
					}),
			}).pipe(
				Effect.catchTag('DaemonWorkspaceRepositoryApiError', (error) =>
					reportDaemonApiFailure(Effect.fail(error)),
				),
				Effect.map(({ repositoryStatus }) => repositoryStatus),
			),
		),
		reportWorkspaceRepositoryResult: Effect.fn('daemon.api.project_workspaces.report_repository_result')((input) =>
			Effect.tryPromise({
				try: (signal) => client.projectWorkspaces.reportRepositoryResult(input, { signal }),
				catch: (cause) => {
					const envelope = Option.getOrUndefined(
						Schema.decodeUnknownOption(RepositoryStatusChangedEnvelope)(cause),
					)
					if (envelope) {
						return new DaemonWorkspaceRepositoryStatusChanged({
							snapshot: envelope.data.snapshot as ConstructorParameters<
								typeof DaemonWorkspaceRepositoryStatusChanged
							>[0]['snapshot'],
						})
					}
					return new DaemonWorkspaceRepositoryApiError({ cause })
				},
			}).pipe(
				Effect.tapErrorTag('DaemonWorkspaceRepositoryApiError', (error) =>
					Effect.logError('Daemon workspace repository API request failed', error.cause),
				),
			),
		),
		getArtifactComments: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.comments.get(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		updateArtifactComments: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.comments.update(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		replyToArtifactComment: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.comments.reply(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		getDiffComments: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.diffComments.get(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		updateDiffComments: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.diffComments.update(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		replyToDiffComment: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.diffComments.reply(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		researchLibrary: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.agents.research(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		createLinearAttachment: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.integrations.linear.createAttachment(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		createJiraRemoteLink: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.integrations.jira.createRemoteLink(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		syncGitHubArtifactBacklink: (input) =>
			reportDaemonApiFailure(
				Effect.tryPromise({
					try: (signal) => client.integrations.github.syncArtifactBacklink(input, { signal }),
					catch: (cause) => new DaemonTaskCapabilityError({ cause }),
				}),
			),
		getSessionWorkspaceSetup: Effect.fn('daemon.api.project_workspaces.get_session_workspace_setup')((input) =>
			Effect.tryPromise({
				try: (signal) => client.projectWorkspaces.getSessionWorkspaceSetup(input, { signal }),
				catch: (cause) =>
					// A missing session is an expected recovery outcome (deleted, reassigned, or never
					// ours), so it stays typed and is not reported as a transport failure.
					isNotFoundResponse(cause)
						? new DaemonWorkspaceSessionSetupNotFound({
								sessionId: input.sessionId,
								workspaceId: input.workspaceId,
							})
						: new DaemonWorkspaceSessionSetupError({ cause }),
			}).pipe(
				Effect.tapErrorTag('DaemonWorkspaceSessionSetupError', (error) =>
					Effect.logError('Daemon API request failed', error.cause).pipe(
						Effect.andThen(
							Effect.sync(() => {
								Sentry.captureException(error.cause, { tags: { error_type: 'daemon_api_request' } })
							}),
						),
					),
				),
			),
		),
		getTaskWorkspaceContext: Effect.fn('daemon.api.project_workspaces.get_task_workspace_context')((input) =>
			Effect.tryPromise({
				try: (signal) => client.projectWorkspaces.getTaskWorkspaceContext(input, { signal }),
				catch: (cause) =>
					// A task without a project workspace is an expected outcome, not a transport failure.
					isNotFoundResponse(cause)
						? new DaemonTaskWorkspaceContextNotFound({ taskId: input.taskId })
						: new DaemonTaskWorkspaceContextError({ taskId: input.taskId, cause }),
			}).pipe(
				Effect.tapErrorTag('DaemonTaskWorkspaceContextError', (error) =>
					Effect.logError('Daemon task workspace context request failed', error.cause).pipe(
						Effect.andThen(
							Effect.sync(() => {
								Sentry.captureException(error.cause, { tags: { error_type: 'daemon_api_request' } })
							}),
						),
					),
				),
			),
		),
	})
