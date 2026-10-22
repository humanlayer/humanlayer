import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { AgentCommand } from '@humanlayer/db/tables/agent-slash-commands'
import type { ChangeMessage } from '@tanstack/db'
import { Cause, Effect, Queue, Stream } from 'effect'

import { createAgentCommandDiscoveryRequestsCollection } from '@/collections/electric/agent-command-discovery-requests'
import { DaemonApi } from '@/effects/services/daemon-api/daemon-api.service'
import { Sentry } from '@/instrument'

import { discoverAgentCommands } from './discover'

export function toAgentCommands(commands: ReadonlyArray<SlashCommand>): AgentCommand[] {
	const mapped: AgentCommand[] = []

	for (const command of commands) {
		const name = command.name.trim()
		if (!name) continue

		const mappedCommand: AgentCommand = { name }
		const description = command.description?.trim()
		const argumentHint = command.argumentHint?.trim()
		if (description) mappedCommand.description = description
		if (argumentHint) mappedCommand.argumentHint = argumentHint
		mapped.push(mappedCommand)
	}

	return mapped.sort((left, right) => left.name.localeCompare(right.name))
}

export const captureAgentCommandsReportFailureAndContinue =
	(attributes: { readonly hostId: string; readonly workspacePath: string | null; readonly sessionId?: string }) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R> =>
		effect.pipe(
			Effect.asVoid,
			Effect.catchCause((cause) =>
				Effect.logWarning('Failed to report agent commands', cause).pipe(
					Effect.annotateLogs(attributes),
					Effect.andThen(
						Effect.sync(() =>
							Sentry.captureException(Cause.squash(cause), {
								tags: { error_type: 'agent_commands_report' },
								extra: { ...attributes, cause: Cause.pretty(cause) },
							}),
						),
					),
				),
			),
		)

export interface ReportAgentSlashCommandsInput {
	readonly hostId: string
}

export const reportAgentSlashCommands = (input: ReportAgentSlashCommandsInput) =>
	Effect.gen(function* () {
		const api = yield* DaemonApi
		const { commands, skills } = yield* discoverAgentCommands({})
		yield* api.reportAgentCommands({ hostId: input.hostId, agent: 'claude', commands, skills })
		yield* Effect.logInfo('Reported host agent commands').pipe(
			Effect.annotateLogs({ hostId: input.hostId, commandCount: commands.length, skillCount: skills.length }),
		)
	}).pipe(
		captureAgentCommandsReportFailureAndContinue({ hostId: input.hostId, workspacePath: null }),
		Effect.withSpan('agent_commands.report_host'),
	)

export interface ReportDiscoveredWorkspaceCommandsInput {
	readonly hostId: string
	readonly workspacePath: string
}

// A directory without its own `.claude` entries offers what the host-level row already lists.
export const reportDiscoveredWorkspaceCommands = (input: ReportDiscoveredWorkspaceCommandsInput) =>
	Effect.gen(function* () {
		const api = yield* DaemonApi
		const { commands, skills } = yield* discoverAgentCommands({ workspacePath: input.workspacePath })
		const hasProjectEntries = [...commands, ...skills].some((entry) => entry.scope === 'project')
		if (!hasProjectEntries) return

		yield* api.reportAgentCommands({
			hostId: input.hostId,
			agent: 'claude',
			workspacePath: input.workspacePath,
			commands,
			skills,
			keepExistingCommands: true,
		})
	}).pipe(
		captureAgentCommandsReportFailureAndContinue({ hostId: input.hostId, workspacePath: input.workspacePath }),
		Effect.withSpan('agent_commands.report_discovered_workspace'),
	)

export interface WatchAgentCommandDiscoveryRequestsInput {
	readonly hostId: string
	readonly syncOrigin: string
	readonly token: string
}

export const watchAgentCommandDiscoveryRequests = (input: WatchAgentCommandDiscoveryRequestsInput) =>
	Effect.gen(function* () {
		const requests = yield* Effect.acquireRelease(
			Effect.sync(() => createAgentCommandDiscoveryRequestsCollection(input.syncOrigin, input.token)),
			(collection) => Effect.promise(() => collection.cleanup()),
		)
		type RequestChange = ChangeMessage<(typeof requests)['toArray'][number], string | number>

		yield* Stream.callback<RequestChange>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() =>
					requests.subscribeChanges(
						(changes) => {
							for (const change of changes) Queue.offerUnsafe(queue, change)
						},
						{ includeInitialState: true },
					),
				),
				(subscription) => Effect.sync(() => subscription.unsubscribe()),
			),
		).pipe(
			Stream.filter((change) => change.type !== 'delete' && change.value.agent === 'claude'),
			Stream.mapEffect((change) =>
				reportDiscoveredWorkspaceCommands({
					hostId: input.hostId,
					workspacePath: change.value.workspace_path,
				}),
			),
			Stream.runDrain,
		)
	}).pipe(Effect.scoped)
