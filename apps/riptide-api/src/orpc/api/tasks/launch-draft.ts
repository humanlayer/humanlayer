import { Effect } from 'effect'
import { hash } from 'ohash'
import { uuidv7 } from 'uuidv7'

import { GitHubService } from '../../../effects/services/github/github.service'
import {
	TaskLaunchConflict,
	TaskLaunchForbidden,
	TaskLaunchUnavailable,
} from '../../../effects/services/task-launch/task-launch.errors'
import { TaskLaunchService } from '../../../effects/services/task-launch/task-launch.service'
import { formatJiraTicketMd } from '../../../lib/format-jira-ticket'
import { LinearIssueUnavailableError } from '../../../lib/linear-service'
import { LinearArtifactService, type PreparedTicketArtifactBundle } from '../../../lib/linear-ticket-artifacts'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../effect-base'
import { TASK_ID_IN_USE_MESSAGE, slugInTaskUsedMessage } from './task-conflict-messages'

function sanitizeArtifactFileStem(stem: string): string {
	return stem.replaceAll(/[^A-Za-z0-9._-]+/g, '-')
}

export const launchTaskDraftProcedure = effectOrpcBaseOrganizationRequired.tasks.launchDraft
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
		const taskLaunch = yield* TaskLaunchService
		let importedTicket: PreparedTicketArtifactBundle | undefined
		const importAttemptId = uuidv7()
		const { ticketProvider, ticketId } = input

		if (ticketProvider === 'linear' && ticketId) {
			importedTicket = yield* Effect.tryPromise({
				try: () =>
					new LinearArtifactService(context.services.linear, context.services.s3).prepareTicketArtifactBundle(
						{
							organizationId: context.auth.organizationId,
							ticketId,
							taskId: input.draftId,
							importAttemptId,
						},
					),
				catch: (cause) =>
					cause instanceof LinearIssueUnavailableError
						? errors.NOT_FOUND({ data: { message: `Couldn't load Linear ticket ${cause.issueId}` } })
						: errors.SERVICE_UNAVAILABLE(),
			})
		}

		if (ticketProvider === 'github' && ticketId) {
			const { githubConnectionId, ticketRepositoryId } = input
			if (githubConnectionId && ticketRepositoryId) {
				const githubBundle = yield* Effect.tryPromise({
					try: () =>
						context.services.effectRuntime.runPromise(
							Effect.gen(function* () {
								const github = yield* GitHubService
								return yield* github.prepareIssueImport({
									organizationId: context.auth.organizationId,
									taskId: input.draftId,
									importAttemptId,
									connectionId: githubConnectionId,
									repositoryId: ticketRepositoryId,
									issueInput: ticketId,
								})
							}),
						),
					catch: () => errors.SERVICE_UNAVAILABLE(),
				})
				const { identity, ticket, images } = githubBundle
				importedTicket = {
					label: `${identity.repositoryFullName}#${identity.issueNumber}`,
					fileName: `${sanitizeArtifactFileStem(`${identity.repositoryFullName}-${identity.issueNumber}`)}.md`,
					content: ticket.content,
					contentHash: ticket.contentHash,
					images,
				}
			}
		}

		if (ticketProvider === 'jira' && ticketId) {
			const issue = yield* Effect.tryPromise({
				try: () => context.services.jira.getIssue(context.auth.organizationId, ticketId),
				catch: () => errors.SERVICE_UNAVAILABLE(),
			})
			const content = formatJiraTicketMd(issue)
			importedTicket = {
				label: issue.key,
				fileName: `${sanitizeArtifactFileStem(issue.key)}.md`,
				content,
				contentHash: hash(content),
				images: [],
			}
		}

		return yield* taskLaunch
			.launchTaskDraft({
				...input,
				importedTicket,
				organizationId: context.auth.organizationId,
				userId: context.auth.userId,
			})
			.pipe(
				Effect.catchTags({
					TaskLaunchConflict: (error: TaskLaunchConflict) =>
						Effect.fail(
							errors.TASK_LAUNCH_CONFLICT({
								data: {
									draftId: error.draftId,
									reason: error.reason,
									message:
										error.reason === 'slug-in-use'
											? slugInTaskUsedMessage(input.slug)
											: TASK_ID_IN_USE_MESSAGE,
								},
							}),
						),
					TaskLaunchForbidden: (_error: TaskLaunchForbidden) => Effect.fail(errors.FORBIDDEN()),
					TaskLaunchUnavailable: (_error: TaskLaunchUnavailable) => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				}),
			)
	})
