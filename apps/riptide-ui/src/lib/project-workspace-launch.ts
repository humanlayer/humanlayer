import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'

import { missingRepositorySources, repositorySourceSummary } from '@/lib/repository-sources'

export type ProjectWorkspaceRepositorySources = RiptideApiOutputs['projectWorkspaces']['repositorySources']['get']

/**
 * - `needs-sources`: no workspace on this host yet and at least one repository has no
 *   saved source. The launcher must collect sources before it can launch.
 * - `sources-chosen`: no workspace on this host yet, but every repository has a source.
 *   Launching creates the workspace.
 * - `placed`: the workspace exists (or is being built) on this host. Nothing to collect.
 */
export type ProjectWorkspaceLaunchStatus = 'loading' | 'error' | 'needs-sources' | 'sources-chosen' | 'placed'

/** What the session launcher shows for a project-backed task on the selected host. */
export interface ProjectWorkspaceLaunchState {
	readonly status: ProjectWorkspaceLaunchStatus
	/** Empty until the sources query resolves. */
	readonly repositories: ProjectWorkspaceRepositorySources['repositories']
	readonly missingRepositoryIdentities: readonly string[]
	readonly sourceSummary: string | null
	/** Where the session will run on this host, as saved by the server; null until set up here. */
	readonly plannedDirectory: string | null
	readonly errorMessage: string | null
}

const EMPTY_STATE: Omit<ProjectWorkspaceLaunchState, 'status'> = {
	repositories: [],
	missingRepositoryIdentities: [],
	sourceSummary: null,
	plannedDirectory: null,
	errorMessage: null,
}

export function deriveProjectWorkspaceLaunchState(input: {
	readonly data: ProjectWorkspaceRepositorySources | undefined
	readonly error: Error | null
}): ProjectWorkspaceLaunchState {
	if (input.error) return { ...EMPTY_STATE, status: 'error', errorMessage: input.error.message }
	if (!input.data) return { ...EMPTY_STATE, status: 'loading' }
	const { data } = input
	const missingRepositoryIdentities = missingRepositorySources(data.sources)
	return {
		status: projectWorkspaceLaunchStatus(data.placementExists, missingRepositoryIdentities),
		repositories: data.repositories,
		missingRepositoryIdentities,
		sourceSummary: repositorySourceSummary(data.sources),
		plannedDirectory: data.sessionDirectory,
		errorMessage: null,
	}
}

function projectWorkspaceLaunchStatus(
	placementExists: boolean,
	missingRepositoryIdentities: readonly string[],
): ProjectWorkspaceLaunchStatus {
	if (placementExists) return 'placed'
	if (missingRepositoryIdentities.length > 0) return 'needs-sources'
	return 'sources-chosen'
}
