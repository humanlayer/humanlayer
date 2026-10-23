import { homedir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
	PROJECT_WORKSPACE_SOURCE_PATH,
	projectWorkspaceViewFromContext,
	repositoryDisplayNames,
	renderProjectWorkspaceSetupProgress,
} from '@/lib/workspace/project-workspace-view'
import {
	expandedWorkspaceBaseDirectory,
	materializedWorkspaceRepoDirectories,
	renderWorkspaceInformation,
	workspaceRepoDirectories,
} from '@/lib/workspace/render-workspace-information'

import {
	FIXTURE_BASE_COMMIT,
	FIXTURE_WORKSPACE_ID,
	makeTaskWorkspaceContext,
} from '../helpers/task-workspace-context-fixture'

const root = `/home/dev/.humanlayer/workspaces/${FIXTURE_WORKSPACE_ID}`
const apiPath = `${root}/api`
const uiPath = `${root}/ui`

it('uses the shortest unique repository suffix for display', () => {
	expect(
		Object.fromEntries(
			repositoryDisplayNames(['github.com/humanlayer/syncopate', 'github.com/acme/app', 'gitlab.com/other/app']),
		),
	).toEqual({
		'github.com/humanlayer/syncopate': 'syncopate',
		'github.com/acme/app': 'acme/app',
		'gitlab.com/other/app': 'other/app',
	})
})

describe('projectWorkspaceViewFromContext', () => {
	it('lists every snapshot repository with this placement, materialized or not', () => {
		const view = projectWorkspaceViewFromContext(
			makeTaskWorkspaceContext({
				repositories: [
					{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: apiPath },
					{ repositoryIdentity: 'github.com/humanlayer/ui', description: 'web client' },
				],
			}),
		)
		expect(view).not.toBeNull()
		expect(view?.source).toBe('project_workspace')
		expect(view?.setupBlocksFirstSession).toBe(false)
		expect(view?.workspaceBaseDirectory).toBe(root)
		expect(view?.repos).toEqual([
			expect.objectContaining({
				localPath: 'github.com/humanlayer/api',
				relativePath: 'api',
				targetPath: apiPath,
				materialized: true,
				status: 'done',
				branch: 'workspace-branch',
				sourceRef: 'main',
				sourceCommit: FIXTURE_BASE_COMMIT,
				primary: true,
				remoteUrl: 'https://github.com/humanlayer/api.git',
			}),
			expect.objectContaining({
				localPath: 'github.com/humanlayer/ui',
				relativePath: 'ui',
				// Not yet materialized: the expected worktree path under the portable placement root.
				targetPath: `~/.humanlayer/workspaces/${FIXTURE_WORKSPACE_ID}/ui`,
				materialized: false,
				status: 'checking_source',
				description: 'web client',
				primary: false,
			}),
		])
	})

	it('keeps the portable root until a worktree exists, then feeds the legacy renderers', () => {
		const pending = projectWorkspaceViewFromContext(
			makeTaskWorkspaceContext({
				repositories: [
					{ repositoryIdentity: 'github.com/humanlayer/api', default: true },
					{ repositoryIdentity: 'github.com/humanlayer/ui' },
				],
			}),
		)
		expect(pending?.workspaceBaseDirectory).toBe(`~/.humanlayer/workspaces/${FIXTURE_WORKSPACE_ID}`)
		expect(pending && expandedWorkspaceBaseDirectory(pending)).toBe(
			join(homedir(), '.humanlayer', 'workspaces', FIXTURE_WORKSPACE_ID),
		)

		const materialized = projectWorkspaceViewFromContext(
			makeTaskWorkspaceContext({
				repositories: [
					{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: apiPath },
					{ repositoryIdentity: 'github.com/humanlayer/ui', materializedPath: uiPath },
				],
			}),
		)
		expect(materialized).not.toBeNull()
		if (materialized === null) return
		// Instructions and skills come from every sibling; trackers only from materialized ones.
		expect(workspaceRepoDirectories(materialized, apiPath)).toEqual([uiPath])
		expect(materializedWorkspaceRepoDirectories(materialized, apiPath)).toEqual([uiPath])
		const information = renderWorkspaceInformation(materialized, apiPath, root)
		expect(information).toContain('Your working directory is ./api')
		expect(information).toContain('../ui')
		expect(information).toContain('primary/default launch repo')
	})

	it('treats a single-repository workspace as the placement root itself', () => {
		const view = projectWorkspaceViewFromContext(
			makeTaskWorkspaceContext({
				repositories: [
					{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: root },
				],
			}),
		)
		expect(view?.repos).toHaveLength(1)
		expect(view?.repos[0]).toMatchObject({ relativePath: '.', targetPath: root, materialized: true })
		expect(view?.workspaceBaseDirectory).toBe(root)
		expect(view && workspaceRepoDirectories(view, root)).toEqual([])
	})

	it('returns no view for a task this user/host never placed', () => {
		expect(
			projectWorkspaceViewFromContext(
				makeTaskWorkspaceContext({
					placed: false,
					repositories: [{ repositoryIdentity: 'github.com/humanlayer/api', default: true }],
				}),
			),
		).toBeNull()
	})

	it('reports a snapshot repository without a status row as unmaterialized rather than dropping it', () => {
		const view = projectWorkspaceViewFromContext(
			makeTaskWorkspaceContext({
				repositories: [
					{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: apiPath },
					{ repositoryIdentity: 'github.com/humanlayer/ui', withoutStatusRow: true },
				],
			}),
		)
		expect(view?.repos.map((repo) => [repo.localPath, repo.materialized, repo.status])).toEqual([
			['github.com/humanlayer/api', true, 'done'],
			['github.com/humanlayer/ui', false, undefined],
		])
	})

	it('labels workspace-sourced directories with the project-workspace provenance', () => {
		expect(PROJECT_WORKSPACE_SOURCE_PATH).not.toContain('task_workspace_setup_for_host')
		expect(PROJECT_WORKSPACE_SOURCE_PATH).not.toContain('workspace_spec')
	})
})

describe('renderProjectWorkspaceSetupProgress', () => {
	it('renders nothing once every repository is done without errors or skips', () => {
		expect(
			renderProjectWorkspaceSetupProgress(
				makeTaskWorkspaceContext({
					repositories: [
						{ repositoryIdentity: 'github.com/humanlayer/api', default: true, materializedPath: apiPath },
						{ repositoryIdentity: 'github.com/humanlayer/ui', materializedPath: uiPath },
					],
				}),
			),
		).toBeNull()
	})

	it('renders running, failed, and skipped stages in the legacy block format', () => {
		const block = renderProjectWorkspaceSetupProgress(
			makeTaskWorkspaceContext({
				repositories: [
					{
						repositoryIdentity: 'github.com/humanlayer/api',
						default: true,
						materializedPath: apiPath,
						status: 'running_setup_command',
						setupCommand: 'bun install',
						error: { stage: 'running_setup_command', message: 'exit 17', stderr: 'boom' },
					},
					{
						repositoryIdentity: 'github.com/humanlayer/ui',
						materializedPath: uiPath,
						status: 'done',
						acceptedSkips: [
							{ stage: 'copying_files', message: 'skipped', skippedByUserId: 'user-1', skippedAt: 1 },
						],
					},
					{ repositoryIdentity: 'github.com/humanlayer/docs', status: 'cloning_source' },
				],
			}),
		)
		expect(block).toBe(
			[
				'<workspace_setup_status>',
				'Note that the following setup steps may still be running, but you can start working while they are running.',
				'',
				'api - bun install - FAILED',
				'ui - copying_files - SKIPPED BY USER',
				'docs - cloning_source - RUNNING',
				'',
				'Current setup error: exit 17',
				'stderr: boom',
				'</workspace_setup_status>',
			].join('\n'),
		)
	})

	it('uses ./ for the single-repository placement', () => {
		const block = renderProjectWorkspaceSetupProgress(
			makeTaskWorkspaceContext({
				repositories: [
					{ repositoryIdentity: 'github.com/humanlayer/api', default: true, status: 'materializing' },
				],
			}),
		)
		expect(block).toContain('./ - materializing - RUNNING')
	})
})
