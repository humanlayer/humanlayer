import type { PullRequestBranch } from '@humanlayer/riptide-api-contract/api/integrations/github/pull-requests/list-branches'
import { Effect } from 'effect'

import { findActiveInstallationRepositories } from '../../../../../effects/services/github/github.persistence'
import {
	findPullRequestsForBranches,
	selectEarlierPullRequestsForBranch,
	selectPullRequestForBranch,
	toPanelPullRequest,
} from '../../../../../effects/services/github/pull-requests/persistence'
import { collectPullRequestCandidates, loadScopeRepositories, type PullRequestScope } from './resolve-target'

/** Without an installation GitHub cannot say which branch is the default, so the usual names stand in. */
const isConventionalDefaultBranch = (branch: string): boolean => branch === 'main' || branch === 'master'

export const listPullRequestBranches = (input: {
	readonly organizationId: string
	readonly userId: string
	readonly scope: PullRequestScope
}) =>
	Effect.gen(function* () {
		const repositories = yield* loadScopeRepositories(input)
		const candidates = collectPullRequestCandidates(repositories)
		const installedRepositories = yield* findActiveInstallationRepositories({
			organizationId: input.organizationId,
			repoFullNames: candidates.map((candidate) => candidate.repoFullName),
		})
		const listed = candidates.flatMap((candidate) => {
			const repository = installedRepositories.get(candidate.repoFullName.toLowerCase()) ?? null
			const defaultBranch = repository?.defaultBranch ?? null
			const isDefaultBranch =
				defaultBranch === null
					? isConventionalDefaultBranch(candidate.branch)
					: defaultBranch === candidate.branch
			if (isDefaultBranch) return []
			return [{ candidate, repository }]
		})
		// The branch is the key: a record another session or task opened still describes this branch.
		const records = yield* findPullRequestsForBranches({
			organizationId: input.organizationId,
			keys: listed.map(({ candidate }) => ({
				repoFullName: candidate.repoFullName,
				branch: candidate.branch,
			})),
		})

		return listed.map(({ candidate, repository }) => {
			const record = selectPullRequestForBranch(records, candidate)
			return {
				repoFullName: repository?.fullName ?? candidate.repoFullName,
				branch: candidate.branch,
				isCurrent: candidate.isCurrent,
				installed: repository !== null,
				sessionIds: [...candidate.sessionIds],
				pullRequest: record ? toPanelPullRequest(record) : null,
				earlierPullRequests: selectEarlierPullRequestsForBranch(records, candidate, record).map(
					toPanelPullRequest,
				),
			} satisfies PullRequestBranch
		})
	}).pipe(
		Effect.withSpan('github.pull_requests.list_branches', {
			attributes: { organization_id: input.organizationId },
		}),
	)
