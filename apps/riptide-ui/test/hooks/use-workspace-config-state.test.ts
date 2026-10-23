import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	host: {
		hostId: 'local-host',
		isColocated: true,
		isRemoteHost: false,
	},
	queryCalls: [] as Array<{
		queryKey: readonly string[]
		queryFn: () => Promise<unknown>
	}>,
	readWorkspaceConfig: vi.fn(),
	readWorkspaceConfigLoadState: vi.fn(async () => ({ status: 'missing' as const })),
	useEffectiveHost: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
	useQuery: vi.fn((options: { queryKey: readonly string[]; queryFn: () => Promise<unknown> }) => {
		mocks.queryCalls.push(options)
		return { data: undefined }
	}),
	useQueryClient: vi.fn(),
}))

vi.mock('@/hooks/use-effective-host', () => ({
	useEffectiveHost: mocks.useEffectiveHost.mockImplementation(() => mocks.host),
}))
vi.mock('@/integrations/desktop/workspace-config', () => ({
	readWorkspaceConfig: mocks.readWorkspaceConfig,
}))
vi.mock('@/lib/utils', () => ({ isElectron: () => false, isTauri: () => true }))
vi.mock('@/lib/workspace-config', async () => ({
	...(await vi.importActual<typeof import('@/lib/workspace-config')>('@/lib/workspace-config')),
	readWorkspaceConfigLoadState: mocks.readWorkspaceConfigLoadState,
}))

const { useWorkspaceConfigLoadState, workspaceConfigQueryKey } = await import('@/hooks/use-workspace-config-state')

describe('useWorkspaceConfigLoadState', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.queryCalls.length = 0
		mocks.host = {
			hostId: 'local-host',
			isColocated: true,
			isRemoteHost: false,
		}
	})

	test('uses the same local-directory query when selecting local and remote hosts', async () => {
		expect(workspaceConfigQueryKey('/Users/alice/repo')).toEqual([
			'workspace-config-load-state',
			'/Users/alice/repo',
		])

		expect(useWorkspaceConfigLoadState('/Users/alice/repo')).toEqual({ status: 'loading' })
		mocks.host = {
			hostId: 'remote-host',
			isColocated: false,
			isRemoteHost: true,
		}
		expect(useWorkspaceConfigLoadState('/Users/alice/repo')).toEqual({ status: 'loading' })

		expect(mocks.queryCalls.map(({ queryKey }) => queryKey)).toEqual([
			['workspace-config-load-state', '/Users/alice/repo'],
			['workspace-config-load-state', '/Users/alice/repo'],
		])
		expect(mocks.useEffectiveHost).not.toHaveBeenCalled()

		await Promise.all(mocks.queryCalls.map(({ queryFn }) => queryFn()))
		expect(mocks.readWorkspaceConfigLoadState).toHaveBeenCalledTimes(2)
		expect(mocks.readWorkspaceConfigLoadState).toHaveBeenNthCalledWith(
			1,
			'/Users/alice/repo',
			mocks.readWorkspaceConfig,
		)
		expect(mocks.readWorkspaceConfigLoadState).toHaveBeenNthCalledWith(
			2,
			'/Users/alice/repo',
			mocks.readWorkspaceConfig,
		)
	})
})
