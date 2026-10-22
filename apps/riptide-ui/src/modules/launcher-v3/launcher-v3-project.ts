import type { RiptideApiOutputs } from '@humanlayer/riptide-api-contract/contract-router'

import type { LauncherV3ProjectLaunch } from './launcher-v3-form'

export type LauncherProject = RiptideApiOutputs['projects']['v2']['get']['project']
export type LauncherProjectLocation = RiptideApiOutputs['projects']['v2']['get']['location']

export type LauncherProjectReadState =
	| { status: 'loading' }
	| { status: 'error'; message: string }
	| { status: 'ready'; project: LauncherProject; location: LauncherProjectLocation }

export type ProjectLaunchBlocker =
	| { code: 'loading'; message: string }
	| { code: 'load-error'; message: string }
	| { code: 'archived'; message: string }
	| { code: 'no-default-repository'; message: string }

export type LauncherProjectLaunchProjection =
	| { kind: 'none' }
	| { kind: 'blocked'; reason: ProjectLaunchBlocker }
	| { kind: 'ready'; project: LauncherV3ProjectLaunch }

/** Resolve the default launch repository: explicit choice, else the project default. */
export function resolveProjectDefaultRepository(
	project: Pick<LauncherProject, 'repositories'>,
	requested: string | null,
): string | null {
	const identities = project.repositories.map((repository) => repository.repositoryIdentity)
	if (requested && identities.includes(requested)) return requested
	return project.repositories.find((repository) => repository.default)?.repositoryIdentity ?? null
}

/**
 * Project the selected V2 project into a launchable workspace recipe. Mirrors
 * `projectWorkspaceLaunch` for the directory path: every blocker has a message
 * the composer can show and nothing here touches the network.
 */
export function projectProjectLaunch({
	projectId,
	readState,
	defaultRepositoryIdentity,
	taskSlug,
}: {
	projectId: string | null
	readState: LauncherProjectReadState
	defaultRepositoryIdentity: string | null
	taskSlug: string
}): LauncherProjectLaunchProjection {
	if (!projectId) return { kind: 'none' }
	if (readState.status === 'loading') {
		return { kind: 'blocked', reason: { code: 'loading', message: 'Loading project...' } }
	}
	if (readState.status === 'error') {
		return { kind: 'blocked', reason: { code: 'load-error', message: readState.message } }
	}
	const { project } = readState
	// The selection can change before its query exposes the next result. Never launch
	// the previous project's recipe as the newly selected project.
	if (project.id !== projectId) {
		return { kind: 'blocked', reason: { code: 'loading', message: 'Loading selected project...' } }
	}
	if (project.archived) {
		return { kind: 'blocked', reason: { code: 'archived', message: 'This project is archived.' } }
	}
	const resolvedDefault = resolveProjectDefaultRepository(project, defaultRepositoryIdentity)
	if (!resolvedDefault) {
		return {
			kind: 'blocked',
			reason: { code: 'no-default-repository', message: 'Choose where sessions launch by default.' },
		}
	}
	return {
		kind: 'ready',
		project: {
			projectId: project.id,
			defaultRepositoryIdentity: resolvedDefault,
			repositories: project.repositories.map((repository) => ({
				...repository,
				branch: taskSlug,
				default: repository.repositoryIdentity === resolvedDefault,
			})),
		},
	}
}
