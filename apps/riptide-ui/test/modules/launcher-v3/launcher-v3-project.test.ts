import { describe, expect, it } from 'vitest'

import {
	type LauncherProject,
	type LauncherProjectLocation,
	projectProjectLaunch,
	resolveProjectDefaultRepository,
} from '@/modules/launcher-v3/launcher-v3-project'

const PROJECT_ID = '019fcc4b-88cd-742f-970e-cd072c8b79f3'

function repository(identity: string, overrides: Partial<LauncherProject['repositories'][number]> = {}) {
	return {
		remoteUrl: `git@github.com:${identity.replace('github.com/', '')}.git`,
		repositoryIdentity: identity,
		defaultBranch: 'main',
		default: false,
		autoPushBranch: false,
		copyGlobs: [],
		...overrides,
	}
}

function project(overrides: Partial<LauncherProject> = {}): LauncherProject {
	return {
		id: PROJECT_ID,
		organizationId: '019fcc4b-88cd-742f-970e-cd072c8b79f4',
		name: 'Syncopate',
		description: null,
		private: false,
		createdBy: 'user-1',
		resourceOwnerUserId: 'user-1',
		repositories: [
			repository('github.com/humanlayer/syncopate', { default: true }),
			repository('github.com/humanlayer/agentlayer'),
		],
		archived: false,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	}
}

function location(paths: Record<string, string>): LauncherProjectLocation {
	return {
		projectId: PROJECT_ID,
		organizationId: '019fcc4b-88cd-742f-970e-cd072c8b79f4',
		userId: 'user-1',
		hostId: 'host-1',
		repositoryPaths: paths,
		createdAt: 0,
		updatedAt: 0,
	}
}

const completeLocation = location({
	'github.com/humanlayer/syncopate': '/repos/syncopate',
	'github.com/humanlayer/agentlayer': '/repos/agentlayer',
})

function ready(overrides: Partial<Parameters<typeof projectProjectLaunch>[0]> = {}) {
	return projectProjectLaunch({
		projectId: PROJECT_ID,
		readState: { status: 'ready', project: project(), location: completeLocation },
		defaultRepositoryIdentity: null,
		taskSlug: 'ship-it',
		...overrides,
	})
}

describe('projectProjectLaunch', () => {
	it('is inert without a project selection', () => {
		expect(ready({ projectId: null })).toEqual({ kind: 'none' })
	})

	it('renders the recipe with the task slug as every branch and the project default selected', () => {
		const projection = ready()
		expect(projection.kind).toBe('ready')
		if (projection.kind !== 'ready') return
		expect(projection.project.projectId).toBe(PROJECT_ID)
		expect(projection.project.defaultRepositoryIdentity).toBe('github.com/humanlayer/syncopate')
		expect(projection.project.repositories.map((repo) => repo.branch)).toEqual(['ship-it', 'ship-it'])
		expect(projection.project.repositories.map((repo) => repo.default)).toEqual([true, false])
	})

	it('honours an explicit default repository and moves the default flag with it', () => {
		const projection = ready({ defaultRepositoryIdentity: 'github.com/humanlayer/agentlayer' })
		if (projection.kind !== 'ready') throw new Error(projection.kind)
		expect(projection.project.defaultRepositoryIdentity).toBe('github.com/humanlayer/agentlayer')
		expect(projection.project.repositories.map((repo) => repo.default)).toEqual([false, true])
	})

	it.each([
		['stale project response', { projectId: 'another-project' }, 'loading'],
		['loading', { readState: { status: 'loading' as const } }, 'loading'],
		['load error', { readState: { status: 'error' as const, message: 'boom' } }, 'load-error'],
		[
			'archived',
			{
				readState: {
					status: 'ready' as const,
					project: project({ archived: true }),
					location: completeLocation,
				},
			},
			'archived',
		],
	])('blocks on %s', (_name, overrides, code) => {
		const projection = ready(overrides)
		expect(projection.kind).toBe('blocked')
		if (projection.kind === 'blocked') expect(projection.reason.code).toBe(code)
	})

	it.each([
		['without a location', null],
		['with a partial location', location({ 'github.com/humanlayer/syncopate': '/repos/syncopate' })],
		['with empty locations', location({})],
	])('launches a project %s', (_name, savedLocation) => {
		const projection = ready({
			readState: { status: 'ready', project: project(), location: savedLocation },
		})
		expect(projection.kind).toBe('ready')
		expect(projection).toEqual(ready())
	})

	it('accepts copy, setup command, and branch publishing recipes', () => {
		const projection = ready({
			readState: {
				status: 'ready',
				project: project({
					repositories: [
						repository('github.com/humanlayer/syncopate', {
							default: true,
							autoPushBranch: true,
							copyGlobs: ['.env'],
							setupCommand: 'bun install',
						}),
					],
				}),
				location: completeLocation,
			},
		})
		expect(projection.kind).toBe('ready')
	})
})

describe('resolveProjectDefaultRepository', () => {
	it('falls back to the project default when the requested identity is unknown', () => {
		expect(resolveProjectDefaultRepository(project(), 'github.com/other/repo')).toBe(
			'github.com/humanlayer/syncopate',
		)
	})
})
