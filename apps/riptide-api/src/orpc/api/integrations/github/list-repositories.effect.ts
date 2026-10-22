import { Effect } from 'effect'

import { GitHubService } from '../../../../effects/services/github/github.service'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

export const listGitHubRepositoriesProcedure =
	effectOrpcBaseOrganizationRequired.integrations.github.listRepositories.effect(function* ({
		input,
		context,
		errors,
	}) {
		const github = yield* GitHubService
		const repositories = yield* github
			.listRepositories({ organizationId: context.auth.organizationId, connectionId: input.connectionId })
			.pipe(
				Effect.catchTags({
					GitHubConnectionNotFoundError: () => Effect.fail(errors.NOT_FOUND()),
					GitHubIntegrationUnavailableError: () => Effect.fail(errors.SERVICE_UNAVAILABLE()),
				}),
			)
		return { repositories: [...repositories] }
	})
