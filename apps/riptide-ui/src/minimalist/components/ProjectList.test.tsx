import type { Session } from '@humanlayer/db/tables/sessions'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectList } from './ProjectList'

const { route, data } = vi.hoisted(() => ({
	route: { selectedTaskId: 'task-7' },
	data: { standalone: [] as Session[], emptyProjects: [] as Array<{ name: string; mine: boolean; tasks?: number }> },
}))
vi.mock('@tanstack/react-router', () => ({
	useParams: () => ({}),
	useNavigate: () => vi.fn(),
	useLocation: () => ({ pathname: '/tasks/task-7', search: {} }),
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}))
vi.mock('@/minimalist/lib/data', () => ({
	useOpenTaskId: () => route.selectedTaskId,
	useTaskTree: () => ({
		isReady: true,
		standalone: data.standalone,
		groups: [
			{
				key: 'project',
				name: 'Project',
				projectId: 'project',
				mine: true,
				tasks: Array.from({ length: 8 }, (_, index) => ({
					task: { id: `task-${index}`, name: `Task ${index}` },
					latest: null,
				})),
			},
			...data.emptyProjects.map(({ name, mine, tasks = 0 }) => ({
				key: name,
				name,
				projectId: name,
				mine,
				tasks: Array.from({ length: tasks }, (_, index) => ({
					task: { id: `${name}-${index}`, name: `${name} task ${index}` },
					latest: null,
				})),
			})),
		],
	}),
}))
vi.mock('@/minimalist/lib/ui-state', () => ({ useUi: () => ({ closeSidebarOnNarrow: vi.fn(), showToast: vi.fn() }) }))
vi.mock('@/orpc/client', () => ({ useRiptideApi: () => ({ client: {} }) }))
vi.mock('./Menu', () => ({ Menu: () => null, MenuItem: () => null }))
vi.mock('./TaskItem', () => ({
	TaskItem: ({ row, selected }: { row: { task: { name: string } }; selected: boolean }) => (
		<a href="#task" aria-current={selected ? 'page' : undefined}>
			{row.task.name}
		</a>
	),
}))

beforeEach(() => {
	localStorage.clear()
	localStorage.setItem('hl-min-collapsed-projects', JSON.stringify(['project']))
	route.selectedTaskId = 'task-7'
	data.standalone = []
	data.emptyProjects = []
})

describe('standalone session names', () => {
	it('shows a generated summary and switches to an explicit name when one is provided', () => {
		data.standalone = [
			{ id: 'session', title: null, summary: 'Standalone summary', last_activity_at: BigInt(Date.now()) },
		] as Session[]
		const view = render(<ProjectList />)
		expect(screen.getByRole('link', { name: /^Standalone summary/ })).toBeInTheDocument()
		data.standalone = [{ ...data.standalone[0]!, title: 'My session name' }]
		view.rerender(<ProjectList />)
		expect(screen.getByRole('link', { name: /^My session name/ })).toBeInTheDocument()
		expect(screen.queryByRole('link', { name: /^Standalone summary/ })).toBeNull()
	})
})
afterEach(cleanup)

describe('selected task project disclosure', () => {
	it('reveals a selected task beyond the preview cap, permits collapse, and reveals only when selection changes', () => {
		const view = render(<ProjectList />)
		const disclosure = screen.getByRole('button', { name: 'Project' })
		expect(disclosure).toHaveAttribute('aria-expanded', 'true')
		expect(screen.getByRole('link', { name: 'Task 7' })).toHaveAttribute('aria-current', 'page')
		fireEvent.click(disclosure)
		expect(disclosure).toHaveAttribute('aria-expanded', 'false')
		// A fresh query result must not undo the user's collapse while the selected task stays the same.
		view.rerender(<ProjectList />)
		expect(disclosure).toHaveAttribute('aria-expanded', 'false')
		expect(screen.queryByRole('link', { name: 'Task 7' })).toBeNull()
		route.selectedTaskId = 'task-2'
		view.rerender(<ProjectList />)
		expect(disclosure).toHaveAttribute('aria-expanded', 'true')
		expect(screen.getByRole('link', { name: 'Task 2' })).toHaveAttribute('aria-current', 'page')
	})
})

describe('shared projects', () => {
	it('hides other people’s projects that hold none of your tasks', () => {
		data.emptyProjects = [
			{ name: 'Mine empty', mine: true },
			{ name: 'Shared empty', mine: false },
		]
		render(<ProjectList />)
		expect(screen.getByRole('button', { name: 'Project' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Mine empty' })).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Shared empty' })).toBeNull()
	})

	it('shows a shared project in blue while it holds one of your tasks', () => {
		data.emptyProjects = [{ name: 'Shared busy', mine: false, tasks: 1 }]
		render(<ProjectList />)
		const toggle = screen.getByRole('button', { name: 'Shared busy' })
		expect(toggle).toHaveAttribute('title', 'Shared busy\nShared with you')
		expect(toggle.querySelector('.proj-icon')).toHaveClass('shared')
		expect(screen.getByRole('button', { name: 'Project' }).querySelector('.proj-icon')).not.toHaveClass('shared')
	})
})
