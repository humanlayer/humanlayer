import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSettingsStore } from '@/hooks/stores/settingsStore'

import { NewTask } from './NewTask'

const { useProjects, useTask, useRecentDirectories, useSlashCommands, launchInTask, startTask, navigate } = vi.hoisted(
	() => ({
		startTask: vi.fn(),
		useProjects: vi.fn(),
		useTask: vi.fn(),
		useRecentDirectories: vi.fn(),
		useSlashCommands: vi.fn(),
		launchInTask: vi.fn(),
		navigate: vi.fn(),
	}),
)

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({}) }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))
vi.mock('@/orpc/client', () => ({
	useRiptideApi: () => ({
		client: {},
		queryClient: {
			projectWorkspaces: { getStatus: { queryOptions: () => ({}) } },
			projects: { v2: { repositorySources: { get: { queryOptions: () => ({}) } } } },
		},
	}),
}))
vi.mock('@/minimalist/lib/launch', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/minimalist/lib/launch')>()),
	launchInTask,
	startTask,
}))
vi.mock('@/minimalist/lib/data', () => ({
	useProjects,
	useTask,
	useRecentDirectories,
	useHosts: () => ({
		hosts: [{ host: { host_id: 'host', supported_models: null }, name: 'Host', online: true }],
		isReady: true,
	}),
	useTaskTree: () => ({ recent: [] }),
	useSlashCommands,
}))
vi.mock('@/minimalist/lib/ui-state', () => ({ useUi: () => ({ showToast: vi.fn() }) }))
vi.mock('@/minimalist/lib/use-attachments', () => ({ useAttachments: () => ({ metadata: [], blocked: false }) }))
vi.mock('@/minimalist/components/Composer', () => ({
	Composer: ({
		value,
		onChange,
		children,
		onSubmit,
		submitDisabled,
		submitLabel,
	}: {
		value: string
		onChange: (value: string) => void
		children: ReactNode
		onSubmit: () => void
		submitDisabled: boolean
		submitLabel: string
	}) => (
		<div>
			{children}
			<textarea aria-label="Task instructions" value={value} onChange={(event) => onChange(event.target.value)} />
			<button type="button" disabled={submitDisabled} onClick={onSubmit}>
				{submitLabel}
			</button>
		</div>
	),
}))
vi.mock('@/minimalist/components/LaunchMenus', () => ({
	HostIcon: () => null,
	HostMenu: ({ onPick }: { onPick: (hostId: string) => void }) => (
		<button type="button" onClick={() => onPick('host')}>
			Pick host
		</button>
	),
	TargetMenu: ({
		open,
		onPick,
	}: {
		open: boolean
		onPick: (target: { kind: 'directory'; path: string }) => void
	}) => (
		<>
			{open ? <div>Project picker</div> : null}
			<button type="button" onClick={() => onPick({ kind: 'directory', path: '/Users/me/repos/self' })}>
				Pick directory
			</button>
		</>
	),
}))
vi.mock('@/minimalist/components/Menu', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/minimalist/components/Menu')>()),
	Menu: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
}))
vi.mock('@/minimalist/components/IssueDialog', () => ({ IssueDialog: () => null }))

beforeEach(() => {
	vi.clearAllMocks()
	localStorage.clear()
	launchInTask.mockResolvedValue(undefined)
	startTask.mockResolvedValue(undefined)
	useProjects.mockReturnValue({ data: [{ id: 'project', name: 'HumanLayer', repositories: [] }], isPending: false })
	useTask.mockReturnValue({ task: null, sessions: [], isReady: true })
	useRecentDirectories.mockReturnValue([])
	useSlashCommands.mockReturnValue([])
})

function expectPlainLanding(container: HTMLElement, heading: string) {
	expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(heading)
	expect(container.querySelector('.hero')?.children).toHaveLength(1)
	expect(container.querySelector('.hero svg')).toBeNull()
	expect(container.querySelector('.cards')).toBeNull()
	expect(screen.getByRole('textbox', { name: 'Task instructions' })).toBeInTheDocument()
}

vi.mock('@/minimalist/components/WiredTaskNavigation', () => ({ WiredTaskNavigation: () => null }))

describe('minimalist launch landing', () => {
	it('shows only the greeting above the input for a new task and keeps the project picker', () => {
		const { container } = render(<NewTask projectId="project" />)
		expectPlainLanding(container, 'What should we work on in HumanLayer?')
		fireEvent.click(within(screen.getByRole('heading')).getByRole('button', { name: 'HumanLayer' }))
		expect(screen.getByText('Project picker')).toBeInTheDocument()
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fix the model picker' } })
		expect(screen.getByRole('textbox')).toHaveValue('Fix the model picker')
	})

	it('names the task when starting a new session', () => {
		useTask.mockReturnValue({
			task: { id: 'task', name: 'Fix tab shortcuts', project_id: 'project', workspace_id: 'workspace' },
			sessions: [{ id: 'session', host_id: 'host', working_directory: '/code/checkout' }],
			isReady: true,
		})
		const { container } = render(<NewTask existingTaskId="task" />)
		expectPlainLanding(container, 'New session in Fix tab shortcuts')
		expect(useSlashCommands).toHaveBeenLastCalledWith({
			hostId: 'host',
			workspacePath: '/code/checkout',
			agent: 'claude',
		})
		expect(screen.queryByRole('button', { name: 'HumanLayer' })).not.toBeInTheDocument()
	})

	it('uses the directory name for a directory task', () => {
		const { container } = render(<NewTask directory="/code/my-app" />)
		expectPlainLanding(container, 'What should we work on in my-app?')
	})

	it('uses the session directory when the task has no project', () => {
		useTask.mockReturnValue({
			task: { id: 'task', name: 'Fix tab shortcuts', project_id: null, workspace_id: null },
			sessions: [{ id: 'session', host_id: 'host', working_directory: '/code/my-app' }],
			isReady: true,
		})
		const { container } = render(<NewTask existingTaskId="task" />)
		expectPlainLanding(container, 'New session in Fix tab shortcuts')
	})

	it('keeps a plain greeting when no project or directory is selected', () => {
		useProjects.mockReturnValue({ data: [], isPending: false })
		const { container } = render(<NewTask />)
		expectPlainLanding(container, 'What should we work on?')
	})
})

describe('minimalist launch autocomplete context', () => {
	it('does not discover the previous host directory when a project task moves to another host', () => {
		useTask.mockReturnValue({
			task: { id: 'task', name: 'Move the project', workspace_id: 'workspace', project_id: 'project' },
			sessions: [{ id: 'session', host_id: 'old-host', working_directory: '/old-host/workspace' }],
			isReady: true,
		})
		render(<NewTask existingTaskId="task" />)
		expect(useSlashCommands).toHaveBeenLastCalledWith({ hostId: 'host', workspacePath: null, agent: 'claude' })
	})

	it('discovers commands for the selected directory and coding agent', () => {
		const previous = useSettingsStore.getState()
		useSettingsStore.setState({ defaultAgent: 'codelayer', defaultCodelayerProvider: 'codex' })
		try {
			render(<NewTask directory="/code/my-app" />)
			expect(useSlashCommands).toHaveBeenLastCalledWith({
				hostId: 'host',
				workspacePath: '/code/my-app',
				agent: 'codelayer',
			})
		} finally {
			useSettingsStore.setState({
				defaultAgent: previous.defaultAgent,
				defaultCodelayerProvider: previous.defaultCodelayerProvider,
			})
		}
	})
})

describe('first session in an existing task', () => {
	it.each([
		{ workspace_id: 'workspace', default_working_directory: null },
		{ workspace_id: null, default_working_directory: '/code/existing' },
	])('launches without creating another task: %j', async (location) => {
		useTask.mockReturnValue({
			task: { id: 'task', name: 'Task with no sessions', project_id: null, slug: 'task', ...location },
			sessions: [],
			isReady: true,
		})
		render(<NewTask existingTaskId="task" />)
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Start working here' } })
		const start = screen.getByRole('button', { name: 'Start session' })
		expect(start).toBeEnabled()
		fireEvent.click(start)
		await waitFor(() => expect(launchInTask).toHaveBeenCalledOnce())
		expect(launchInTask.mock.calls[0]?.[1]).toMatchObject({ id: 'task' })
		expect(launchInTask.mock.calls[0]?.[2]).toMatchObject({
			hostId: 'host',
			text: 'Start working here',
			workingDirectory: location.default_working_directory ?? '',
		})
		expect(navigate).toHaveBeenCalledWith(
			expect.objectContaining({
				to: '/tasks/$taskId',
				params: { taskId: 'task' },
				search: { session: expect.any(String) },
			}),
		)
	})
})

describe('picking where a new task runs', () => {
	it('keeps a picked directory when the host is picked after it', async () => {
		// With a project to fall back on, losing the directory would launch a project worktree.
		render(<NewTask />)
		fireEvent.click(screen.getByRole('button', { name: 'Pick directory' }))
		fireEvent.click(screen.getByRole('button', { name: 'Pick host' }))
		expect(screen.getByText('In this directory')).toBeInTheDocument()
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Prep the weekly update' } })
		fireEvent.click(screen.getByRole('button', { name: 'Start task' }))
		await waitFor(() => expect(startTask).toHaveBeenCalledOnce())
		expect(startTask.mock.calls[0]?.[1]).toMatchObject({
			target: { kind: 'directory', path: '/Users/me/repos/self' },
		})
	})
})

describe('picking how big a new task is', () => {
	it('launches the workflow of the picked size and remembers the pick', async () => {
		const { unmount } = render(<NewTask />)
		fireEvent.click(screen.getByRole('button', { name: "Task size: Don't know yet" }))
		fireEvent.click(screen.getByRole('button', { name: /^Medium/ }))
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add workflow picking' } })
		fireEvent.click(screen.getByRole('button', { name: 'Start task' }))
		await waitFor(() => expect(startTask).toHaveBeenCalledOnce())
		expect(startTask.mock.calls[0]?.[1]).toMatchObject({
			workflow: { workflowType: 'outline_only', autoAdvance: true },
		})
		unmount()
		render(<NewTask />)
		expect(screen.getByRole('button', { name: 'Task size: Medium' })).toBeInTheDocument()
	})

	it('launches a small task toward a pull request, with auto-advance that can be turned off', async () => {
		render(<NewTask />)
		fireEvent.click(screen.getByRole('button', { name: "Task size: Don't know yet" }))
		fireEvent.click(screen.getByRole('button', { name: /^Small/ }))
		fireEvent.click(screen.getByRole('button', { name: 'Task size: Small, auto-advance to pull request' }))
		fireEvent.click(screen.getByRole('button', { name: /^Auto-advance to pull request/ }))
		expect(screen.getByRole('button', { name: 'Task size: Small' })).toBeInTheDocument()
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fix the typo' } })
		fireEvent.click(screen.getByRole('button', { name: 'Start task' }))
		await waitFor(() => expect(startTask).toHaveBeenCalledOnce())
		expect(startTask.mock.calls[0]?.[1]).toMatchObject({
			workflow: { workflowType: 'freeform', autoAdvance: false },
			directImplementation: true,
		})
	})
})
