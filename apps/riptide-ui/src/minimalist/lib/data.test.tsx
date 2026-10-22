import { createCollection, type SyncConfig } from '@tanstack/db'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/hooks/stores/settingsStore'

import {
	compareHosts,
	recentSourceDirectories,
	useHost,
	useHosts,
	useSlashCommands,
	useTask,
	useTaskArtifacts,
	useTaskTree,
} from './data'

const { useSync, useBrowserAuth, workspaceStatus, projectsList } = vi.hoisted(() => ({
	useSync: vi.fn(),
	useBrowserAuth: vi.fn(),
	workspaceStatus: vi.fn(),
	projectsList: vi.fn(),
}))
vi.mock('@/components/providers/SyncProvider', () => ({ useSync }))
vi.mock('@/orpc/client', () => ({
	useRiptideApi: () => ({
		queryClient: {
			projects: {
				v2: {
					list: {
						queryOptions: ({ input }: { input: { archived: boolean } }) => ({
							queryKey: ['projects-test', input.archived],
							queryFn: () => projectsList(input.archived),
						}),
					},
				},
			},
			projectWorkspaces: {
				getStatus: {
					queryOptions: ({ input }: { input: { taskId: string } }) => ({
						queryKey: ['workspace-test', input.taskId],
						queryFn: () => workspaceStatus(input.taskId),
					}),
				},
			},
			workspaceSetup: {
				getStatus: { queryOptions: () => ({ queryKey: ['setup-test'], queryFn: async () => ({}) }) },
			},
			agentCommands: {
				discoverWorkspace: {
					queryOptions: ({ input }: { input: unknown }) => ({
						queryKey: ['discoverWorkspace', input],
						queryFn: async () => ({}),
					}),
				},
			},
		},
	}),
}))
vi.mock('@/hooks/use-browser-auth', () => ({ useBrowserAuth }))

const taskId = '01a0e423-1e80-7e3f-a38c-c106feccae5d'
const hostId = '14648abd-db99-4c4f-a324-8a25cc9887c9'

function trackedCollection<T extends { id: string }>(rows: T[]) {
	const loadSubset = vi.fn(() => true as const)
	const sync = vi.fn<SyncConfig<T>['sync']>(({ begin, write, commit, markReady }) => {
		begin()
		for (const value of rows) write({ type: 'insert', value })
		commit()
		markReady()
		return { loadSubset }
	})
	const collection = createCollection({ getKey: (row: T) => row.id, syncMode: 'on-demand', sync: { sync } })
	return { collection, sync, loadSubset }
}

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})

describe('optional sync query IDs', () => {
	it.each([null, undefined, ''])('does not subscribe to hosts for ID %s', (id) => {
		const hosts = trackedCollection([{ id: hostId, host_id: hostId, user_id: 'teammate' }])
		useSync.mockReturnValue({ onlineHostsCollection: hosts.collection })

		const { result } = renderHook(() => useHost(id, 'teammate'))

		expect(result.current.host).toBeNull()
		expect(hosts.sync).not.toHaveBeenCalled()
	})

	it.each([null, undefined, ''])('does not subscribe to hosts without the daemon user: %s', (userId) => {
		const hosts = trackedCollection([{ id: hostId, host_id: hostId, user_id: 'teammate' }])
		useSync.mockReturnValue({ onlineHostsCollection: hosts.collection })

		const { result } = renderHook(() => useHost(hostId, userId))

		expect(result.current.host).toBeNull()
		expect(hosts.sync).not.toHaveBeenCalled()
	})

	it.each([null, undefined, ''])('does not subscribe to tasks or sessions for ID %s', (id) => {
		const tasks = trackedCollection([{ id: taskId }])
		const sessions = trackedCollection([{ id: 'session', task_id: taskId, created_at: 1 }])
		useSync.mockReturnValue({ tasksCollection: tasks.collection, sessionsCollection: sessions.collection })

		const { result } = renderHook(() => useTask(id))

		expect(result.current.task).toBeNull()
		expect(result.current.sessions).toEqual([])
		expect(tasks.sync).not.toHaveBeenCalled()
		expect(sessions.sync).not.toHaveBeenCalled()
	})

	it('subscribes when a task ID arrives and clears the result when it is removed', async () => {
		const tasks = trackedCollection([{ id: taskId }])
		const sessions = trackedCollection([{ id: 'session', task_id: taskId, created_at: 1 }])
		useSync.mockReturnValue({ tasksCollection: tasks.collection, sessionsCollection: sessions.collection })
		const { result, rerender } = renderHook(({ id }) => useTask(id), {
			initialProps: { id: null as string | null },
		})

		rerender({ id: taskId })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(result.current.task?.id).toBe(taskId)
		expect(result.current.sessions.map((session) => session.id)).toEqual(['session'])
		expect(tasks.loadSubset).toHaveBeenCalled()
		expect(sessions.loadSubset).toHaveBeenCalled()

		rerender({ id: null })
		expect(result.current.task).toBeNull()
		expect(result.current.sessions).toEqual([])
	})

	it('does not query artifacts without a task, then loads them when a task is selected', async () => {
		const artifacts = trackedCollection([
			{ id: 'artifact', task_id: taskId, is_deleted: false, last_updated_at: 1 },
		])
		useSync.mockReturnValue({ artifactsMetadataCollection: artifacts.collection })
		const { result, rerender } = renderHook(({ id }) => useTaskArtifacts(id), {
			initialProps: { id: null as string | null },
		})
		expect(result.current).toEqual([])
		expect(artifacts.sync).not.toHaveBeenCalled()

		rerender({ id: taskId })
		await waitFor(() => expect(result.current.map((artifact) => artifact.id)).toEqual(['artifact']))
	})

	it('offers bundled skills without a host, then keeps them alongside discovered commands', async () => {
		const slashCommands = trackedCollection([
			{
				id: 'commands',
				host_id: hostId,
				agent: 'claude',
				workspace_path: '/test',
				commands: [{ name: 'test', description: null }],
				skills: [],
			},
		])
		useSync.mockReturnValue({ agentSlashCommandsCollection: slashCommands.collection })
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const { result, rerender } = renderHook(
			({ id }) => useSlashCommands({ hostId: id, workspacePath: '/test', agent: 'claude' }),
			{
				initialProps: { id: null as string | null },
				wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
			},
		)
		expect(result.current.filter((command) => command.name.startsWith('/rpi:'))).toHaveLength(27)
		expect(result.current).toContainEqual(expect.objectContaining({ name: '/hl:show-me', kind: 'skill' }))
		expect(result.current.some((command) => command.name === '/compact')).toBe(false)
		expect(slashCommands.sync).not.toHaveBeenCalled()

		rerender({ id: hostId })
		await waitFor(() =>
			expect(result.current).toContainEqual(
				expect.objectContaining({ name: '/test', source: 'local', kind: 'command' }),
			),
		)
		expect(result.current.filter((command) => command.name.startsWith('/rpi:'))).toHaveLength(27)
	})
})

describe('minimalist command discovery', () => {
	it('keeps the full bundled catalog when discovery is disabled and uses session-only fallbacks on continuation', () => {
		const slashCommands = trackedCollection([
			{ id: 'unused', host_id: hostId, agent: 'claude', workspace_path: '', commands: [], skills: [] },
		])
		useSync.mockReturnValue({ agentSlashCommandsCollection: slashCommands.collection })
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const enabled = useSettingsStore.getState().agentCommandDiscoveryEnabled
		useSettingsStore.setState({ agentCommandDiscoveryEnabled: false })
		try {
			const { result, rerender } = renderHook(
				({ continuingSession }) =>
					useSlashCommands({ hostId, workspacePath: '/unreported', agent: 'claude', continuingSession }),
				{
					initialProps: { continuingSession: false },
					wrapper: ({ children }) => (
						<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
					),
				},
			)
			expect(result.current.filter((command) => command.name.startsWith('/rpi:'))).toHaveLength(27)
			expect(result.current.find((command) => command.name === '/rpi:create-outline')?.insertText).toBe(
				'/rpi:create-structure-outline',
			)
			expect(slashCommands.sync).not.toHaveBeenCalled()
			rerender({ continuingSession: true })
			expect(result.current.map((command) => command.name)).toEqual(
				expect.arrayContaining(['/compact', '/bro', '/rpi:implement-outline']),
			)
		} finally {
			useSettingsStore.setState({ agentCommandDiscoveryEnabled: enabled })
		}
	})

	it('uses the selected agent and exact workspace, preserves host entries, and canonicalizes discovered aliases', async () => {
		const slashCommands = trackedCollection([
			{
				id: 'host',
				host_id: hostId,
				agent: 'claude',
				workspace_path: '',
				commands: [{ name: 'host-command', description: 'Host command' }],
				skills: [],
			},
			{
				id: 'workspace',
				host_id: hostId,
				agent: 'claude',
				workspace_path: '/selected',
				commands: [{ name: 'workspace-command' }, { name: 'compact' }],
				skills: [{ name: 'rpi:create-outline', description: 'Discovered outline skill' }],
			},
			{
				id: 'other-workspace',
				host_id: hostId,
				agent: 'claude',
				workspace_path: '/other',
				commands: [{ name: 'unrelated-command' }],
				skills: [],
			},
			{
				id: 'codex',
				host_id: hostId,
				agent: 'codelayer',
				workspace_path: '',
				commands: [{ name: 'codex-command' }],
				skills: [],
			},
		])
		useSync.mockReturnValue({ agentSlashCommandsCollection: slashCommands.collection })
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const { result, rerender } = renderHook(
			({ agent, workspacePath }) => useSlashCommands({ hostId, agent, workspacePath }),
			{
				initialProps: { agent: 'claude' as 'claude' | 'codelayer', workspacePath: '/selected' },
				wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
			},
		)
		await waitFor(() =>
			expect(result.current.find((command) => command.name === '/rpi:create-outline')).toMatchObject({
				description: 'Discovered outline skill',
				source: 'local',
				insertText: '/rpi:create-structure-outline',
				kind: 'skill',
			}),
		)
		expect(result.current.map((command) => command.name)).toEqual(
			expect.arrayContaining(['/host-command', '/workspace-command']),
		)
		expect(
			result.current.some((command) =>
				['/compact', '/unrelated-command', '/codex-command'].includes(command.name),
			),
		).toBe(false)
		expect(result.current.filter((command) => command.name === '/rpi:create-outline')).toHaveLength(1)

		rerender({ agent: 'claude', workspacePath: '/unreported' })
		await waitFor(() => expect(result.current.some((command) => command.name === '/workspace-command')).toBe(false))
		expect(result.current.some((command) => command.name === '/host-command')).toBe(true)
		rerender({ agent: 'codelayer', workspacePath: '/selected' })
		await waitFor(() => expect(result.current.some((command) => command.name === '/codex-command')).toBe(true))
		expect(result.current.some((command) => command.name === '/host-command')).toBe(false)
		expect(result.current.filter((command) => command.name.startsWith('/rpi:'))).toHaveLength(27)
	})
})

describe('session host lookup', () => {
	it('reads the exact teammate registration despite a stale own registration with the same host id', async () => {
		const supported_models = {
			probedAt: 1,
			anthropic: { status: 'unavailable', reason: 'binary_missing', models: [] },
			codex: { status: 'unavailable', reason: 'transport', models: [] },
		}
		const rows = [
			{
				id: 'a-own',
				host_id: hostId,
				user_id: 'me',
				host_name: 'My host',
				status: 'online',
				last_seen: BigInt(Date.now() - 60_000),
				supported_models: {
					...supported_models,
					codex: { status: 'unavailable', reason: 'not_logged_in', models: [] },
				},
			},
			{
				id: 'z-teammate',
				host_id: hostId,
				user_id: 'teammate',
				host_name: 'Shared host',
				status: 'online',
				last_seen: BigInt(Date.now()),
				supported_models,
			},
		]
		const hosts = trackedCollection(rows)
		useSync.mockReturnValue({ onlineHostsCollection: hosts.collection })
		useBrowserAuth.mockReturnValue({ user: { id: 'me' } })
		const { result } = renderHook(() => ({ launch: useHosts(), session: useHost(hostId, 'teammate') }))

		await waitFor(() => expect(result.current.session.isReady && result.current.launch.isReady).toBe(true))
		expect(result.current.session.host).toMatchObject({
			host: { host_id: hostId, user_id: 'teammate', supported_models },
			name: 'Shared host',
			online: true,
			stale: false,
		})
		expect(result.current.launch.hosts.map((host) => host.host.user_id)).toEqual(['me'])
		expect(result.current.launch.hosts[0]?.online).toBe(false)
	})

	it.each([
		{ status: 'offline', age: 0, stale: false },
		{ status: 'online', age: 60_000, stale: true },
	])('keeps offline and stale session hosts readable: %j', async ({ status, age, stale }) => {
		const lastSeen = Date.now() - age
		const hosts = trackedCollection([
			{ id: hostId, host_id: hostId, user_id: 'teammate', host_name: null, status, last_seen: BigInt(lastSeen) },
		])
		useSync.mockReturnValue({ onlineHostsCollection: hosts.collection })
		const { result } = renderHook(() => useHost(hostId, 'teammate'))

		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(result.current.host).toMatchObject({
			host: { host_id: hostId },
			name: hostId.slice(0, 8),
			online: false,
			stale,
			lastSeen,
		})
	})

	it('looks up hosts when the session host ID changes and clears absent IDs', async () => {
		const rows = [hostId, 'second'].map((id) => ({
			id,
			host_id: id,
			user_id: 'teammate',
			host_name: id,
			status: 'online',
			last_seen: BigInt(Date.now()),
		}))
		const hosts = trackedCollection(rows)
		useSync.mockReturnValue({ onlineHostsCollection: hosts.collection })
		const { result, rerender } = renderHook(({ id }) => useHost(id, 'teammate'), {
			initialProps: { id: null as string | null },
		})

		rerender({ id: hostId })
		await waitFor(() => expect(result.current.host?.host.host_id).toBe(hostId))
		rerender({ id: 'second' })
		await waitFor(() => expect(result.current.host?.host.host_id).toBe('second'))
		rerender({ id: 'unknown' })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(result.current.host).toBeNull()
		rerender({ id: null })
		expect(result.current.host).toBeNull()
	})

	it('matches the daemon user even when another registration is newer, and updates when only the user changes', async () => {
		const hosts = trackedCollection([
			{
				id: 'a-owner',
				host_id: hostId,
				user_id: 'owner',
				host_name: 'Owner registration',
				status: 'offline',
				last_seen: BigInt(Date.now() - 60_000),
			},
			{
				id: 'z-invitee',
				host_id: hostId,
				user_id: 'invitee',
				host_name: 'Invitee registration',
				status: 'online',
				last_seen: BigInt(Date.now()),
			},
		])
		useSync.mockReturnValue({ onlineHostsCollection: hosts.collection })
		const { result, rerender } = renderHook(({ userId }) => useHost(hostId, userId), {
			initialProps: { userId: 'owner' as string | null },
		})

		await waitFor(() => expect(result.current.host?.host.user_id).toBe('owner'))
		expect(result.current.host?.online).toBe(false)
		rerender({ userId: 'invitee' })
		await waitFor(() => expect(result.current.host?.host.user_id).toBe('invitee'))
		expect(result.current.host?.online).toBe(true)
		rerender({ userId: 'unknown' })
		await waitFor(() => expect(result.current.isReady).toBe(true))
		expect(result.current.host).toBeNull()
		rerender({ userId: 'invitee' })
		await waitFor(() => expect(result.current.host?.host.user_id).toBe('invitee'))
		rerender({ userId: null })
		expect(result.current.host).toBeNull()
	})
})

describe('project/task/session membership', () => {
	beforeEach(() => useBrowserAuth.mockReturnValue({ user: { id: 'me' } }))

	it('keeps tasks reachable when a workspace relationship read fails, without calling it loading', async () => {
		const tasks = trackedCollection([
			{
				id: 'workspace-task',
				name: 'Task',
				workspace_id: 'workspace',
				project_id: null,
				archived: false,
				is_draft: false,
				resource_owner_user_id: 'me',
				updated_at: 1,
			},
		])
		const sessions = trackedCollection<{ id: string }>([])
		useSync.mockReturnValue({ tasksCollection: tasks.collection, sessionsCollection: sessions.collection })
		projectsList.mockResolvedValue({ projects: [] })
		workspaceStatus.mockRejectedValue(new Error('Could not load workspace'))
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const { result } = renderHook(() => useTaskTree(), {
			wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
		})
		await waitFor(() => expect(result.current.groups[0]?.workspaceReadFailed).toBe(true))
		expect(result.current.groups[0]?.name).toBe('Could not load project')
		expect(result.current.groups[0]?.tasks[0]?.task.id).toBe('workspace-task')
	})

	it('uses workspace project membership, retains zero-session tasks and keeps standalone sessions separate', async () => {
		const tasks = trackedCollection([
			{
				id: 'workspace-task',
				name: 'Workspace task',
				workspace_id: 'workspace',
				project_id: 'legacy-wrong',
				archived: false,
				is_draft: false,
				resource_owner_user_id: 'me',
				updated_at: 1,
			},
			{
				id: 'empty-task',
				name: 'Zero sessions',
				workspace_id: null,
				project_id: null,
				archived: false,
				is_draft: false,
				resource_owner_user_id: 'me',
				updated_at: 2,
			},
		])
		const sessions = trackedCollection([
			{ id: 'fork', task_id: 'workspace-task', status: 'running', archived: false, created_at: 3, updated_at: 3 },
			{
				id: 'handoff',
				task_id: 'workspace-task',
				status: 'ready_for_input',
				archived: false,
				created_at: 4,
				updated_at: 4,
			},
			{
				id: 'standalone',
				task_id: null,
				resource_owner_user_id: 'me',
				status: 'ready_for_input',
				archived: false,
				created_at: 5,
				updated_at: 5,
			},
		])
		useSync.mockReturnValue({ tasksCollection: tasks.collection, sessionsCollection: sessions.collection })
		projectsList.mockImplementation(async (archived) => ({
			projects: archived
				? []
				: [{ id: 'actual-project', name: 'Actual project', description: null, repositories: [] }],
		}))
		workspaceStatus.mockResolvedValue({ workspace: { projectId: 'actual-project' } })
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const { result } = renderHook(() => useTaskTree(), {
			wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
		})
		await waitFor(() =>
			expect(result.current.groups.find((group) => group.key === 'actual-project')?.tasks).toHaveLength(1),
		)
		expect(
			result.current.groups
				.find((group) => group.key === 'actual-project')
				?.tasks[0]?.sessions.map((session) => session.id),
		).toEqual(['handoff', 'fork'])
		expect(result.current.groups.find((group) => group.key === 'other')?.tasks[0]?.task.id).toBe('empty-task')
		expect(result.current.standalone.map((session) => session.id)).toEqual(['standalone'])
		expect(result.current.groups.find((group) => group.key === 'legacy-wrong')).toBeUndefined()
	})

	it('shows only your tasks and those you started a session in, grouped by repository, unless asked for everyone', async () => {
		const task = (id: string, owner: string, directory: string) => ({
			id,
			name: id,
			workspace_id: null,
			project_id: null,
			archived: false,
			is_draft: false,
			resource_owner_user_id: owner,
			default_working_directory: directory,
			updated_at: 1,
		})
		const tasks = trackedCollection([
			task('mine', 'me', '/Users/me/code/humanlayer'),
			task('joined', 'teammate', '/Users/teammate/code/syncopate'),
			task('theirs', 'teammate', '/Users/teammate/code/other'),
		])
		const sessions = trackedCollection([
			{
				id: 's1',
				task_id: 'joined',
				created_by: 'me',
				status: 'ready_for_input',
				archived: false,
				created_at: 1,
				updated_at: 1,
			},
			{
				id: 's2',
				task_id: null,
				resource_owner_user_id: 'teammate',
				status: 'ready_for_input',
				archived: false,
				created_at: 1,
				updated_at: 1,
			},
		])
		useSync.mockReturnValue({ tasksCollection: tasks.collection, sessionsCollection: sessions.collection })
		projectsList.mockResolvedValue({ projects: [] })
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		)
		const mine = renderHook(() => useTaskTree(), { wrapper })
		await waitFor(() => expect(mine.result.current.recent).toHaveLength(2))
		expect(mine.result.current.recent.map((row) => row.task.id).sort()).toEqual(['joined', 'mine'])
		expect(mine.result.current.groups.find((group) => group.key === 'dir:syncopate')).toMatchObject({
			name: 'syncopate',
			detail: '/Users/teammate/code/syncopate',
		})
		expect(mine.result.current.standalone).toEqual([])
		const everyone = renderHook(() => useTaskTree(false, 'everyone'), { wrapper })
		await waitFor(() => expect(everyone.result.current.recent).toHaveLength(3))
		expect(everyone.result.current.groups.map((group) => group.name)).toEqual(['humanlayer', 'other', 'syncopate'])
	})
})

describe('compareHosts', () => {
	const view = (name: string, online: boolean, lastSeen: number, local = false) => ({
		host: { host_id: name },
		name,
		online,
		lastSeen,
		local,
	})
	it('keeps online hosts in name order whichever sent the latest heartbeat, so the default host holds still', () => {
		const before = [view('beta', true, 2), view('alpha', true, 1), view('old', false, 5)].sort(compareHosts)
		const after = [view('beta', true, 3), view('alpha', true, 4), view('old', false, 5)].sort(compareHosts)
		expect(before.map((host) => host.name)).toEqual(['alpha', 'beta', 'old'])
		expect(after.map((host) => host.name)).toEqual(['alpha', 'beta', 'old'])
	})
	it('lists offline hosts after online ones, most recently seen first', () => {
		const sorted = [view('a', false, 1), view('b', false, 9), view('c', true, 0)].sort(compareHosts)
		expect(sorted.map((host) => host.name)).toEqual(['c', 'b', 'a'])
	})
	it("puts this computer's host first among online hosts, and among offline ones", () => {
		const sorted = [
			view('alpha', true, 1),
			view('zulu', true, 1, true),
			view('seen', false, 9),
			view('mine', false, 2, true),
		].sort(compareHosts)
		expect(sorted.map((host) => host.name)).toEqual(['zulu', 'alpha', 'mine', 'seen'])
	})
})

describe('recentSourceDirectories', () => {
	it('lists a directory task in worktrees as the directory it started from', () => {
		const worktree = '~/.humanlayer/workspaces/fix-login-0001/app'
		const tasks = [
			{ default_working_directory: worktree, workspace_spec: { directory: '/code/app' } },
			{ default_working_directory: '/code/other', workspace_spec: null },
		] as never
		expect(
			recentSourceDirectories([worktree, '/code/other', '/code/app', '~/.humanlayer/workspaces/x/y'], tasks),
		).toEqual(['/code/app', '/code/other'])
	})
})
