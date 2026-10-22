import { Effect } from 'effect'
import { hash } from 'ohash'
import { uuidv7 } from 'uuidv7'

import { createTaskV2 } from '../../../../effects/project-workspace/create-task-v2'
import { GitHubService } from '../../../../effects/services/github/github.service'
import { formatJiraTicketMd } from '../../../../lib/format-jira-ticket'
import { LinearArtifactService, type PreparedTicketArtifactBundle } from '../../../../lib/linear-ticket-artifacts'
import { effectOrpcBaseOrganizationRequired, requiresBillingEffectMiddleware } from '../../../effect-base'

function sanitizeArtifactFileStem(stem: string): string {
	return stem.replaceAll(/[^A-Za-z0-9._-]+/g, '-')
}

export const createTaskV2Procedure = effectOrpcBaseOrganizationRequired.tasks.v2.create
	.use(requiresBillingEffectMiddleware)
	.effect(function* ({ input, context, errors }) {
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
							taskId: input.taskId,
							importAttemptId,
						},
					),
				catch: () => errors.SERVICE_UNAVAILABLE(),
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
									taskId: input.taskId,
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

		return yield* createTaskV2({
			...input,
			actor: { organizationId: context.auth.organizationId, userId: context.auth.userId },
			importedTicket,
		}).pipe(
			Effect.catchTags({
				ProjectsV2Disabled: () => Effect.fail(errors.FORBIDDEN()),
				ProjectNotFound: (error) =>
					Effect.fail(errors.PROJECT_NOT_FOUND({ data: { projectId: error.projectId } })),
				ProjectLocationInvalid: (error) =>
					Effect.fail(errors.LOCATION_MISSING({ data: { message: error.message } })),
				UnsupportedRecipeProfile: (error) =>
					Effect.fail(errors.UNSUPPORTED_RECIPE({ data: { message: error.message } })),
				ProjectPersistenceUnavailable: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				RepositorySourcesRequired: (error) =>
					Effect.fail(
						errors.REPOSITORY_SOURCES_REQUIRED({
							data: {
								projectId: error.projectId,
								workspaceId: error.workspaceId,
								hostId: error.hostId,
								missingRepositoryIdentities: [...error.missingRepositoryIdentities],
							},
						}),
					),
				PostgresDbQueryError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				PostgresDbTransactionError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
			}),
		)
	})
