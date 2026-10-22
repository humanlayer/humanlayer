import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { WorkspaceRepoCreateResult, WorkspaceRepoInput } from '@/integrations/tauri/workspace-setup'
import type { EffectiveRepoEntry, EffectiveWorkspaceConfig } from '@/lib/workspace-config-schema'

type SetupResult = { ok: true; stdout: string; stderr: string; exitCode: number }

let setupCalls: string[] = []
let resolveSetup: Record<string, () => void> = {}

vi.mock('sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/integrations/sentry/sentry', () => ({
	captureException: vi.fn(),
}))

const workspacePreflightMock = vi.fn(async ({ repos }: { repos: WorkspaceRepoInput[] }) => ({
	ok: true,
	repos: repos.map((repo) => ({ localPath: repo.localPath, ok: true })),
}))

const workspaceCreateMock = vi.fn(async ({ repos }: { repos: WorkspaceRepoInput[] }) => ({
	ok: true,
	repos: repos.map((repo) => ({
		localPath: repo.localPath,
		targetPath: repo.targetPath,
		expandedTargetPath: repo.targetPath,
		resolvedSourceRef: 'origin/main',
		remoteUrl: 'git@github.com:acme/repo.git',
		resolvedSha: 'abc1234def',
		ok: true,
		error: '',
	})),
}))

const workspaceCopyGlobsMock = vi.fn(async ({ repos }: { repos: WorkspaceRepoInput[] }) => ({
	ok: true,
	repos: repos.map((repo) => ({ localPath: repo.localPath, ok: true })),
}))

const workspaceRemoveAllMock = vi.fn(async () => ({ ok: true }))

const workspaceRunSetupMock = vi.fn(async ({ localPath }: { localPath: string }): Promise<SetupResult> => {
	setupCalls.push(localPath)
	return new Promise((resolve) => {
		resolveSetup[localPath] = () => resolve({ ok: true, stdout: '', stderr: '', exitCode: 0 })
	})
})

vi.mock('@/integrations/tauri/workspace-setup', () => ({
	workspacePreflight: workspacePreflightMock,
	workspaceCreate: workspaceCreateMock,
	workspaceCopyGlobs: workspaceCopyGlobsMock,
	workspaceRemoveAll: workspaceRemoveAllMock,
	workspaceRunSetup: workspaceRunSetupMock,
}))

const {
	buildFinishedWorkspaceSetupState,
	buildInlineTicketContent,
	isAtomicTaskCreateVisible,
	buildWorkspaceState,
	normalizePathToHome,
	prepareWorkspaceNowTaskCreation,
	runWorkspaceNowPipeline,
} = await import('@/lib/new-task-form-helpers')
const { renderWorkspaceSpec } = await import('@/lib/workspace-setup')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRepoEntry(localPath: string, overrides: Partial<EffectiveRepoEntry> = {}): EffectiveRepoEntry {
	return {
		localPath,
		sourceRef: 'origin/main',
		setupCommand: '',
		copyGlobs: [],
		primary: false,
		...overrides,
	}
}

function makeRepoInput(localPath: string, targetPath: string, setupCommand = ''): WorkspaceRepoInput {
	return {
		localPath,
		targetPath,
		branch: 'task',
		sourceRef: 'origin/main',
		setupCommand,
		copyGlobs: [],
	}
}

function makeEffectiveConfig(repos: EffectiveRepoEntry[]): EffectiveWorkspaceConfig {
	return {
		disabled: false,
		setupBlocksFirstSession: false,
		disabledSource: 'default',
		pathTemplate: '~/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}',
		branchTemplate: '{{ TASKSLUG }}',
		sourceRef: 'origin/main',
		setupCommand: '',
		copyGlobs: [],
		repos,
		isMissingConfig: false,
	}
}

function makeOperationTracker() {
	const operations: Array<{ id: string; status: string; errorMessage?: string }> = []
	const updateOp = (id: string, updates: { status?: string; errorMessage?: string }) => {
		if (updates.status) operations.push({ id, status: updates.status, errorMessage: updates.errorMessage })
	}
	return { operations, updateOp }
}

function makeCreateResult(
	localPath: string,
	targetPath: string,
	overrides: Partial<WorkspaceRepoCreateResult> = {},
): WorkspaceRepoCreateResult {
	return {
		localPath,
		targetPath,
		expandedTargetPath: targetPath,
		resolvedSourceRef: null,
		remoteUrl: null,
		resolvedSha: null,
		ok: true,
		error: '',
		...overrides,
	}
}

describe('runWorkspaceNowPipeline', () => {
	beforeEach(() => {
		setupCalls = []
		resolveSetup = {}
		workspacePreflightMock.mockClear()
		workspaceCreateMock.mockClear()
		workspaceCopyGlobsMock.mockClear()
		workspaceRemoveAllMock.mockClear()
		workspaceRunSetupMock.mockClear()
	})

	test('starts repo setup commands concurrently', async () => {
		const { operations, updateOp } = makeOperationTracker()

		const pipelinePromise = runWorkspaceNowPipeline({
			selectedDirectory: '/repos/main',
			taskSlug: 'task',
			repos: [
				makeRepoEntry('.', { primary: true, setupCommand: 'bun install' }),
				makeRepoEntry('../api', { setupCommand: 'bun install' }),
			],
			repoInputs: [
				makeRepoInput('.', '/worktrees/task/main', 'bun install'),
				makeRepoInput('../api', '/worktrees/task/api', 'bun install'),
			],
			dispatchSubmit: vi.fn(),
			updateOp,
			waitForWorkspaceAction: async () => 'proceed_anyway',
		})

		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(setupCalls).toEqual(['.', '../api'])
		expect(operations).toContainEqual({ id: 'ws-setup-.', status: 'running', errorMessage: undefined })
		expect(operations).toContainEqual({ id: 'ws-setup-../api', status: 'running', errorMessage: undefined })

		resolveSetup['.']()
		resolveSetup['../api']()

		const result = await pipelinePromise
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.workingDirectory).toBe('/worktrees/task/main')
			expect(result.createResults).toHaveLength(2)
		}
	})

	test('working directory is the primary repo expanded target path (not localPath ".")', async () => {
		const { updateOp } = makeOperationTracker()

		const result = await runWorkspaceNowPipeline({
			selectedDirectory: '/repos/main',
			taskSlug: 'task',
			repos: [makeRepoEntry('.'), makeRepoEntry('../api', { primary: true })],
			repoInputs: [makeRepoInput('.', '/worktrees/task/main'), makeRepoInput('../api', '/worktrees/task/api')],
			dispatchSubmit: vi.fn(),
			updateOp,
			waitForWorkspaceAction: async () => 'proceed_anyway',
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.workingDirectory).toBe('/worktrees/task/api')
		}
	})

	test('returns create results carrying expanded paths and git identity', async () => {
		const { updateOp } = makeOperationTracker()

		const result = await runWorkspaceNowPipeline({
			selectedDirectory: '/repos/main',
			taskSlug: 'task',
			repos: [makeRepoEntry('.', { primary: true }), makeRepoEntry('../api')],
			repoInputs: [makeRepoInput('.', '/worktrees/task/main'), makeRepoInput('../api', '/worktrees/task/api')],
			dispatchSubmit: vi.fn(),
			updateOp,
			waitForWorkspaceAction: async () => 'proceed_anyway',
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.createResults.map((r) => r.expandedTargetPath)).toEqual([
				'/worktrees/task/main',
				'/worktrees/task/api',
			])
			expect(result.createResults.every((r) => r.remoteUrl === 'git@github.com:acme/repo.git')).toBe(true)
			expect(result.createResults.every((r) => r.resolvedSha === 'abc1234def')).toBe(true)
			expect(result.createResults.every((r) => r.resolvedSourceRef === 'origin/main')).toBe(true)
		}
	})

	test('fails before any native call when the selection has no primary repo', async () => {
		const { operations, updateOp } = makeOperationTracker()

		const result = await runWorkspaceNowPipeline({
			selectedDirectory: '/repos/main',
			taskSlug: 'task',
			repos: [makeRepoEntry('.'), makeRepoEntry('../api')],
			repoInputs: [makeRepoInput('.', '/worktrees/task/main'), makeRepoInput('../api', '/worktrees/task/api')],
			dispatchSubmit: vi.fn(),
			updateOp,
			waitForWorkspaceAction: async () => 'proceed_anyway',
		})

		expect(result).toEqual({ ok: false, aborted: false })
		expect(workspacePreflightMock.mock.calls.length).toBe(0)
		expect(workspaceCreateMock.mock.calls.length).toBe(0)
		const errorOp = operations.find((op) => op.id === 'ws-preflight' && op.status === 'error')
		expect(errorOp?.errorMessage).toContain('no primary repository')
	})

	test('fails before any native call when the selection has multiple primary repos', async () => {
		const { operations, updateOp } = makeOperationTracker()

		const result = await runWorkspaceNowPipeline({
			selectedDirectory: '/repos/main',
			taskSlug: 'task',
			repos: [makeRepoEntry('.', { primary: true }), makeRepoEntry('../api', { primary: true })],
			repoInputs: [makeRepoInput('.', '/worktrees/task/main'), makeRepoInput('../api', '/worktrees/task/api')],
			dispatchSubmit: vi.fn(),
			updateOp,
			waitForWorkspaceAction: async () => 'proceed_anyway',
		})

		expect(result).toEqual({ ok: false, aborted: false })
		expect(workspacePreflightMock.mock.calls.length).toBe(0)
		const errorOp = operations.find((op) => op.id === 'ws-preflight' && op.status === 'error')
		expect(errorOp?.errorMessage).toContain('multiple primary repositories')
	})

	test('fails before any native call when target paths do not share a parent directory', async () => {
		const { operations, updateOp } = makeOperationTracker()

		const result = await runWorkspaceNowPipeline({
			selectedDirectory: '/repos/main',
			taskSlug: 'task',
			repos: [makeRepoEntry('.', { primary: true }), makeRepoEntry('../api')],
			repoInputs: [makeRepoInput('.', '/wt/main/task'), makeRepoInput('../api', '/wt/api/task')],
			dispatchSubmit: vi.fn(),
			updateOp,
			waitForWorkspaceAction: async () => 'proceed_anyway',
		})

		expect(result).toEqual({ ok: false, aborted: false })
		expect(workspacePreflightMock.mock.calls.length).toBe(0)
		const errorOp = operations.find((op) => op.id === 'ws-preflight' && op.status === 'error')
		expect(errorOp?.errorMessage).toContain('share one parent directory')
	})

	test('single-repo selection marked primary succeeds and uses its worktree', async () => {
		const { updateOp } = makeOperationTracker()

		const result = await runWorkspaceNowPipeline({
			selectedDirectory: '/repos/main',
			taskSlug: 'task',
			repos: [makeRepoEntry('../api', { primary: true })],
			repoInputs: [makeRepoInput('../api', '/worktrees/task/api')],
			dispatchSubmit: vi.fn(),
			updateOp,
			waitForWorkspaceAction: async () => 'proceed_anyway',
		})

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.workingDirectory).toBe('/worktrees/task/api')
		}
	})
})

describe('buildWorkspaceState', () => {
	test('relativizes repo paths against the non-expanded base directory', () => {
		const state = buildWorkspaceState(
			[
				makeRepoInput('.', '~/.humanlayer/workspaces/task/main'),
				makeRepoInput('../api', '~/.humanlayer/workspaces/task/api'),
			],
			[makeRepoEntry('.', { primary: true }), makeRepoEntry('../api')],
			[
				makeCreateResult('.', '~/.humanlayer/workspaces/task/main', {
					expandedTargetPath: '/Users/alice/.humanlayer/workspaces/task/main',
				}),
				makeCreateResult('../api', '~/.humanlayer/workspaces/task/api', {
					expandedTargetPath: '/Users/alice/.humanlayer/workspaces/task/api',
				}),
			],
		)

		expect(state.workspaceBaseDirectory).toBe('~/.humanlayer/workspaces/task')
		expect(state.repos.map((r) => r.path)).toEqual(['main', 'api'])
	})

	test('carries branch, resolved sourceRef, and the primary flag per repo', () => {
		const state = buildWorkspaceState(
			[
				makeRepoInput('.', '~/wt/task/main'),
				{ ...makeRepoInput('../api', '~/wt/task/api'), branch: 'task-api', sourceRef: 'origin/develop' },
			],
			[makeRepoEntry('.'), makeRepoEntry('../api', { primary: true })],
			[
				makeCreateResult('.', '~/wt/task/main', { resolvedSourceRef: 'upstream/main' }),
				makeCreateResult('../api', '~/wt/task/api', { resolvedSourceRef: 'fork/develop' }),
			],
		)

		expect(state.repos[0]).toMatchObject({ branch: 'task', sourceRef: 'upstream/main', primary: false })
		expect(state.repos[1]).toMatchObject({ branch: 'task-api', sourceRef: 'fork/develop', primary: true })
	})

	test('includes description, remoteUrl, and sourceCommit when present', () => {
		const state = buildWorkspaceState(
			[makeRepoInput('.', '~/wt/task/main')],
			[makeRepoEntry('.', { primary: true, description: 'HumanLayer monorepo' })],
			[
				makeCreateResult('.', '~/wt/task/main', {
					resolvedSourceRef: 'source/main',
					remoteUrl: 'git@github.com:acme/main.git',
					resolvedSha: 'abc1234def',
				}),
			],
		)

		expect(state.repos[0]).toEqual({
			path: 'main',
			description: 'HumanLayer monorepo',
			remoteUrl: 'git@github.com:acme/main.git',
			sourceRef: 'source/main',
			sourceCommit: 'abc1234def',
			branch: 'task',
			primary: true,
		})
	})

	test('omits optional fields instead of fabricating them', () => {
		const state = buildWorkspaceState(
			[makeRepoInput('.', '~/wt/task/main')],
			[makeRepoEntry('.', { primary: true })],
			[
				makeCreateResult('.', '~/wt/task/main', {
					resolvedSourceRef: null,
					remoteUrl: null,
					resolvedSha: null,
				}),
			],
		)

		const repo = state.repos[0]!
		expect('description' in repo).toBe(false)
		expect('remoteUrl' in repo).toBe(false)
		expect('sourceCommit' in repo).toBe(false)
		expect(Object.keys(repo).sort()).toEqual(['branch', 'path', 'primary', 'sourceRef'])
		expect(repo.sourceRef).toBe('origin/main')
	})

	test('preserves config-declared order regardless of create-result order', () => {
		const state = buildWorkspaceState(
			[
				makeRepoInput('.', '~/wt/task/main'),
				makeRepoInput('../api', '~/wt/task/api'),
				makeRepoInput('../docs', '~/wt/task/docs'),
			],
			[makeRepoEntry('.', { primary: true }), makeRepoEntry('../api'), makeRepoEntry('../docs')],
			[
				makeCreateResult('../docs', '~/wt/task/docs'),
				makeCreateResult('.', '~/wt/task/main'),
				makeCreateResult('../api', '~/wt/task/api'),
			],
		)

		expect(state.repos.map((r) => r.path)).toEqual(['main', 'api', 'docs'])
	})

	test('tolerates a missing create result (git identity is best-effort)', () => {
		const state = buildWorkspaceState(
			[makeRepoInput('.', '~/wt/task/main'), makeRepoInput('../api', '~/wt/task/api')],
			[makeRepoEntry('.', { primary: true }), makeRepoEntry('../api')],
			[makeCreateResult('.', '~/wt/task/main')],
		)

		expect(state.repos[1]).toMatchObject({ path: 'api', branch: 'task', primary: false })
		expect(state.repos[1]?.sourceRef).toBe('origin/main')
		expect('remoteUrl' in state.repos[1]!).toBe(false)
		expect('sourceCommit' in state.repos[1]!).toBe(false)
	})

	test('throws when target paths do not share one parent directory', () => {
		expect(() =>
			buildWorkspaceState(
				[makeRepoInput('.', '/wt/main/task'), makeRepoInput('../api', '/wt/api/task')],
				[makeRepoEntry('.', { primary: true }), makeRepoEntry('../api')],
				[makeCreateResult('.', '/wt/main/task'), makeCreateResult('../api', '/wt/api/task')],
			),
		).toThrow('share one parent directory')
	})

	test('throws when an effective repo entry is missing for a rendered input', () => {
		expect(() =>
			buildWorkspaceState(
				[makeRepoInput('.', '~/wt/task/main')],
				[makeRepoEntry('../api', { primary: true })],
				[makeCreateResult('.', '~/wt/task/main')],
			),
		).toThrow('No effective repo entry found')
	})
})

describe('normalizePathToHome', () => {
	test('rewrites the exact home and separator-bounded descendants', () => {
		expect(normalizePathToHome('/Users/alice', '/Users/alice/')).toBe('~')
		expect(normalizePathToHome('/Users/alice/repos/app', '/Users/alice///')).toBe('~/repos/app')
	})

	test('rewrites Windows homes and nested paths with portable forward slashes', () => {
		expect(normalizePathToHome('C:\\Users\\alice', 'C:\\Users\\alice\\')).toBe('~')
		expect(normalizePathToHome('C:\\Users\\alice\\repos\\app', 'C:\\Users\\alice\\\\')).toBe('~/repos/app')
		expect(normalizePathToHome('C:\\Users\\alice/repos\\web/src', 'C:\\Users\\alice')).toBe('~/repos/web/src')
	})

	test('preserves existing tilde and relative paths', () => {
		expect(normalizePathToHome('~', '/Users/alice')).toBe('~')
		expect(normalizePathToHome('~/repos/app', '/Users/alice')).toBe('~/repos/app')
		expect(normalizePathToHome('../api', '/Users/alice')).toBe('../api')
		expect(normalizePathToHome('repos/app', '/Users/alice')).toBe('repos/app')
	})

	test('rejects home-prefix collisions and absolute paths outside home', () => {
		expect(() => normalizePathToHome('/Users/alice-two/repos/app', '/Users/alice')).toThrow(
			'Path "/Users/alice-two/repos/app" is outside the launching home directory "/Users/alice"',
		)
		expect(() => normalizePathToHome('/opt/repos/app', '/Users/alice')).toThrow(
			'Path "/opt/repos/app" is outside the launching home directory "/Users/alice"',
		)
	})
})

describe('durable workspace setup payloads', () => {
	test('prepares daemon task creation from selected repos and the primary repo', () => {
		const config = makeEffectiveConfig([
			makeRepoEntry('.', { setupCommand: 'bun install' }),
			makeRepoEntry('../api', {
				primary: true,
				setupCommand: 'bun --bun run dev',
				copyGlobs: ['.env'],
			}),
		])

		const prepared = prepareWorkspaceNowTaskCreation({
			config,
			selectedDirectory: '~/src/main',
			taskSlug: 'eng-123-daemon-setup',
		})

		expect(prepared.primaryWorkingDirectory).toBe('~/.humanlayer/workspaces/eng-123-daemon-setup/api')
		expect(prepared.repoInputs.map((repo) => repo.localPath)).toEqual(['.', '../api'])
		expect(prepared.workspaceSpec).toMatchObject({
			directory: '~/src/main',
			workspaceBaseDirectory: '~/.humanlayer/workspaces/eng-123-daemon-setup',
			repos: [
				{ localPath: '.', primary: false, setupCommand: 'bun install' },
				{
					localPath: '../api',
					primary: true,
					setupCommand: 'bun --bun run dev',
					copyGlobs: ['.env'],
				},
			],
		})
	})

	test('normalizes every persisted workspace path without changing local setup inputs', () => {
		const config = makeEffectiveConfig([makeRepoEntry('.', { primary: true }), makeRepoEntry('../api')])
		config.pathTemplate = '/Users/alice/.humanlayer/workspaces/{{ TASKSLUG }}/{{ REPOBASENAME }}'

		const prepared = prepareWorkspaceNowTaskCreation({
			config,
			selectedDirectory: '/Users/alice/src/main',
			taskSlug: 'eng-123-portable-paths',
			pathTransform: (path) => normalizePathToHome(path, '/Users/alice/'),
		})

		expect(prepared.workspaceSpec).toMatchObject({
			directory: '~/src/main',
			workspaceBaseDirectory: '~/.humanlayer/workspaces/eng-123-portable-paths',
			repos: [
				{
					localPath: '.',
					targetPath: '~/.humanlayer/workspaces/eng-123-portable-paths/main',
				},
				{
					localPath: '../api',
					targetPath: '~/.humanlayer/workspaces/eng-123-portable-paths/api',
				},
			],
		})
		expect(prepared.primaryWorkingDirectory).toBe('~/.humanlayer/workspaces/eng-123-portable-paths/main')
		expect(prepared.repoInputs.map(({ localPath, targetPath }) => ({ localPath, targetPath }))).toEqual([
			{
				localPath: '.',
				targetPath: '/Users/alice/.humanlayer/workspaces/eng-123-portable-paths/main',
			},
			{
				localPath: '../api',
				targetPath: '/Users/alice/.humanlayer/workspaces/eng-123-portable-paths/api',
			},
		])
	})

	test('keeps local prepared paths unchanged when no transform is provided', () => {
		const config = makeEffectiveConfig([makeRepoEntry('.', { primary: true })])
		config.pathTemplate = '/Users/alice/worktrees/{{ TASKSLUG }}/{{ REPOBASENAME }}'

		const prepared = prepareWorkspaceNowTaskCreation({
			config,
			selectedDirectory: '/Users/alice/src/main',
			taskSlug: 'local-task',
		})

		expect(prepared.workspaceSpec.directory).toBe('/Users/alice/src/main')
		expect(prepared.workspaceSpec.workspaceBaseDirectory).toBe('/Users/alice/worktrees/local-task')
		expect(prepared.workspaceSpec.repos[0]?.targetPath).toBe('/Users/alice/worktrees/local-task/main')
		expect(prepared.primaryWorkingDirectory).toBe('/Users/alice/worktrees/local-task/main')
		expect(prepared.repoInputs[0]?.targetPath).toBe('/Users/alice/worktrees/local-task/main')
	})

	test('rejects daemon task preparation without exactly one primary repo', () => {
		const config = makeEffectiveConfig([makeRepoEntry('.'), makeRepoEntry('../api')])

		expect(() =>
			prepareWorkspaceNowTaskCreation({
				config,
				selectedDirectory: '~/src/main',
				taskSlug: 'eng-123-daemon-setup',
			}),
		).toThrow('exactly one primary repository')
	})

	test('renders workspace spec from the same repo inputs used by the synchronous Tauri path', () => {
		const config = makeEffectiveConfig([
			makeRepoEntry('.', { primary: true, setupCommand: 'bun install', copyGlobs: ['.env'] }),
			makeRepoEntry('../api'),
		])
		config.setupBlocksFirstSession = true
		const repoInputs = [
			{ ...makeRepoInput('.', '~/.humanlayer/workspaces/task/main', 'bun install'), copyGlobs: ['.env'] },
			makeRepoInput('../api', '~/.humanlayer/workspaces/task/api'),
		]

		expect(renderWorkspaceSpec({ config, selectedDirectory: '~/src/main', repoInputs })).toEqual({
			specVersion: 1,
			directory: '~/src/main',
			workspaceBaseDirectory: '~/.humanlayer/workspaces/task',
			setupBlocksFirstSession: true,
			repos: [
				{
					localPath: '.',
					targetPath: '~/.humanlayer/workspaces/task/main',
					branch: 'task',
					sourceRef: 'origin/main',
					setupCommand: 'bun install',
					copyGlobs: ['.env'],
					primary: true,
				},
				{
					localPath: '../api',
					targetPath: '~/.humanlayer/workspaces/task/api',
					branch: 'task',
					sourceRef: 'origin/main',
					copyGlobs: [],
					primary: false,
				},
			],
		})
	})

	test('converts successful Tauri results and proceed-anyway decisions into a finished ledger', () => {
		const repoInputs = [
			makeRepoInput('.', '~/.humanlayer/workspaces/task/main', 'bun install'),
			makeRepoInput('../api', '~/.humanlayer/workspaces/task/api'),
		]
		const createResults = [
			makeCreateResult('.', '~/.humanlayer/workspaces/task/main', {
				expandedTargetPath: '/Users/alice/.humanlayer/workspaces/task/main',
				remoteUrl: 'git@github.com:acme/main.git',
				resolvedSha: 'abc123',
			}),
			makeCreateResult('../api', '~/.humanlayer/workspaces/task/api', {
				expandedTargetPath: '/Users/alice/.humanlayer/workspaces/task/api',
				resolvedSha: 'def456',
			}),
		]

		const state = buildFinishedWorkspaceSetupState({
			repoInputs,
			createResults,
			setupResults: [
				{
					ok: false,
					stdout: '',
					stderr: 'install failed',
					exitCode: 1,
					error: '',
					repo: { ...repoInputs[0]!, opId: 'ws-setup-.' },
				},
			],
			acceptedSkips: [
				{
					localPath: '.',
					stage: 'setup_command',
					skippedAt: 150,
					command: 'bun install',
					errorMessage: 'Exit 1: install failed',
				},
			],
			userId: 'user-1',
			startedAt: 100,
			finishedAt: 200,
		})

		expect(state).toMatchObject({
			specVersion: 1,
			startedAt: 100,
			finishedAt: 200,
			repos: [
				{
					localPath: '.',
					status: 'done',
					preflight: { resolvedSourceCommit: 'abc123' },
					worktree: {
						targetPath: '/Users/alice/.humanlayer/workspaces/task/main',
						remoteUrl: 'git@github.com:acme/main.git',
					},
					setupCommand: { command: 'bun install', exitCode: 1 },
				},
				{
					localPath: '../api',
					status: 'done',
					preflight: { resolvedSourceCommit: 'def456' },
					worktree: { targetPath: '/Users/alice/.humanlayer/workspaces/task/api' },
				},
			],
			acceptedSkips: [
				{
					localPath: '.',
					stage: 'setup_command',
					skippedByUserId: 'user-1',
					skippedAt: 150,
				},
			],
		})
	})
})

describe('buildInlineTicketContent', () => {
	test('formats a trimmed inline description', () => {
		expect(buildInlineTicketContent({ effectiveName: 'Inline task', description: '  Task details  ' })).toBe(
			'# Inline task\n\nTask details',
		)
	})

	test('returns null for an empty inline description', () => {
		expect(buildInlineTicketContent({ effectiveName: 'Inline task', description: '   ' })).toBeNull()
	})
})

describe('isAtomicTaskCreateVisible', () => {
	test.each([
		[true, undefined, true],
		[true, true, true],
		[true, false, false],
		[false, true, false],
	] as const)('requires the task and any requested first session', (taskVisible, firstSessionVisible, expected) => {
		expect(isAtomicTaskCreateVisible({ taskVisible, firstSessionVisible })).toBe(expected)
	})
})
