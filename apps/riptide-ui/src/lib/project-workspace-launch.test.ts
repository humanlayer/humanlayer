import { describe, expect, test } from 'vitest'

import { deriveProjectWorkspaceLaunchState, type ProjectWorkspaceRepositorySources } from './project-workspace-launch'

const repository = (
	repositoryIdentity: string,
	isDefault: boolean,
): ProjectWorkspaceRepositorySources['repositories'][number] => ({
	repositoryIdentity,
	remoteUrl: `git@${repositoryIdentity.replace('/', ':')}.git`,
	defaultBranch: 'main',
	branch: 'my-task',
	default: isDefault,
	autoPushBranch: false,
	copyGlobs: [],
})

const repositories: ProjectWorkspaceRepositorySources['repositories'] = [
	repository('github.com/Effect-TS/effect', false),
	repository('github.com/humanlayer/syncopate', true),
]

const response = (overrides: Partial<ProjectWorkspaceRepositorySources> = {}): ProjectWorkspaceRepositorySources => ({
	taskId: '01a0b726-3977-7ae0-aab5-f713b54a9620',
	hostId: 'host-1',
	projectId: '01a08715-689d-7ded-8450-3b4c70b5457b',
	workspaceId: '01a0b726-3977-7ae0-aab5-f713b54a9620',
	placementExists: false,
	sessionDirectory: null,
	repositories,
	sources: {
		'github.com/Effect-TS/effect': { kind: 'unknown' },
		'github.com/humanlayer/syncopate': { kind: 'filesystem', path: '~/repos/syncopate' },
	},
	...overrides,
})

describe('deriveProjectWorkspaceLaunchState', () => {
	test('reports loading and error before data arrives', () => {
		expect(deriveProjectWorkspaceLaunchState({ data: undefined, error: null })).toMatchObject({
			status: 'loading',
			repositories: [],
			plannedDirectory: null,
		})
		expect(deriveProjectWorkspaceLaunchState({ data: undefined, error: new Error('offline') })).toMatchObject({
			status: 'error',
			errorMessage: 'offline',
		})
	})

	test('needs sources while any repository has no saved source and no workspace exists', () => {
		const state = deriveProjectWorkspaceLaunchState({ data: response(), error: null })
		expect(state.status).toBe('needs-sources')
		expect(state.missingRepositoryIdentities).toEqual(['github.com/Effect-TS/effect'])
		expect(state.plannedDirectory).toBeNull()
	})

	test('is ready to launch once every repository has a source', () => {
		const state = deriveProjectWorkspaceLaunchState({
			data: response({
				sources: {
					'github.com/Effect-TS/effect': { kind: 'managed_clone' },
					'github.com/humanlayer/syncopate': { kind: 'filesystem', path: '~/repos/syncopate' },
				},
			}),
			error: null,
		})
		expect(state.status).toBe('sources-chosen')
		expect(state.sourceSummary).toBe('1 existing checkout · 1 managed clone')
	})

	test('is placed once this host has a workspace, even with unknown sources', () => {
		const state = deriveProjectWorkspaceLaunchState({
			data: response({
				placementExists: true,
				sessionDirectory: '~/.humanlayer/workspaces/my-task/github.com--humanlayer--syncopate',
			}),
			error: null,
		})
		expect(state.status).toBe('placed')
		expect(state.plannedDirectory).toBe('~/.humanlayer/workspaces/my-task/github.com--humanlayer--syncopate')
	})
})
