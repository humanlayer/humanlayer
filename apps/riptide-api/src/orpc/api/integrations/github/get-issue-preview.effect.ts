import { Effect } from 'effect'

import { GitHubService } from '../../../../effects/services/github/github.service'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const getGitHubIssuePreviewProcedure =
	effectOrpcBaseOrganizationRequired.integrations.github.getIssuePreview.effect(function* ({
		input,
		context,
		errors,
	}) {
		const github = yield* GitHubService
		const preview = yield* github
			.getIssuePreview({
				organizationId: context.auth.organizationId,
				connectionId: input.connectionId,
				repositoryId: input.repositoryId,
				issueInput: input.issueInput,
			})
			.pipe(
				Effect.catchTags({
					GitHubConnectionNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubRepositoryNotAccessibleError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubIssueNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubIntegrationDisabledError: () =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: 'github_integration_disabled' } })),
					GitHubInstallationSuspendedError: () =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: 'github_installation_suspended' } })),
					GitHubMissingPermissionsError: () =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: 'github_issues_permission_required' } })),
					GitHubIssueInputInvalidError: (error) =>
						Effect.fail(errors.BAD_REQUEST({ data: { message: error.reason } })),
					GitHubIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				}),
			)
		return {
			...preview,
			labels: [...preview.labels],
			assignees: [...preview.assignees],
			comments: preview.comments.map((comment) => ({ ...comment })),
		}
	})
