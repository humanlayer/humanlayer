import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Session } from '@humanlayer/db/tables/sessions'
import { createCollection, type SyncConfig } from '@tanstack/db'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { WiredTaskNavigation } from './WiredTaskNavigation'

type NavigationSession = Pick<Session, 'id' | 'task_id' | 'title' | 'summary' | 'archived' | 'status' | 'labels'>

const { useSync, data, updateTask } = vi.hoisted(() => ({
	useSync: vi.fn(),
	updateTask: vi.fn(async () => ({})),
	data: { sessions: [] as NavigationSession[] },
}))
vi.mock('./TaskDetails', () => ({ WiredTaskDetails: () => null }))
vi.mock('@/orpc/client', () => ({ useRiptideApi: () => ({ client: { tasks: { update: updateTask } } }) }))
vi.mock('@/minimalist/lib/auto-advance', () => ({
	useTaskAutoAdvance: () => ({ available: false, on: false, handOffs: [], toggle: vi.fn() }),
}))
vi.mock('@/minimalist/lib/pull-requests', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/minimalist/lib/pull-requests')>()),
	useTaskPullRequest: () => ({ branch: null }),
}))
vi.mock('./ReviewPanel', () => ({ useDiffTotals: () => null }))
vi.mock('@/components/providers/SyncProvider', () => ({ useSync }))
vi.mock('@/minimalist/lib/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/minimalist/lib/data')>()),
	useTask: () => ({ task: { id: 'task', name: 'Task name' }, sessions: data.sessions }),
	useTaskArtifacts: () => [],
	canReview: () => false,
}))
vi.mock('@tanstack/react-router', () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="#new-session">{children}</a>,
}))
vi.mock('@/minimalist/lib/task-navigation', () => ({
	useTaskNavigation: () => ({ search: {}, selectSession: vi.fn() }),
}))
vi.mock('@/minimalist/lib/ui-state', () => ({
	useUi: () => ({ closeTaskSidebarOnNarrow: vi.fn(), toggleTaskSidebar: vi.fn() }),
}))

/** Exercise the same committed collection updates that Electric delivers to useSession. */
function syncedSession(initial: NavigationSession) {
	let current = initial
	let update: (fields: Pick<Session, 'title' | 'summary'>) => void = () => {
		throw new Error('Session collection has not subscribed')
	}
	const sync: SyncConfig<NavigationSession>['sync'] = ({ begin, write, commit, markReady }) => {
		begin()
		write({ type: 'insert', value: current })
		commit()
		markReady()
		update = (fields) => {
			current = { ...current, ...fields }
			begin()
			write({ type: 'update', value: current })
			commit()
		}
		return { loadSubset: () => true }
	}
	const collection = createCollection({
		getKey: (row: NavigationSession) => row.id,
		syncMode: 'on-demand',
		sync: { sync },
	})
	return { collection, update: (fields: Pick<Session, 'title' | 'summary'>) => update(fields) }
}

describe('task navigation session names', () => {
	it('shows a generated summary as soon as it syncs and preserves an explicit name on later summary updates', async () => {
		const initial: NavigationSession = {
			id: 'session',
			task_id: 'task',
			title: null,
			summary: null,
			archived: false,
			status: 'ready_for_input',
			labels: [],
		}
		data.sessions = [initial]
		const sessions = syncedSession(initial)
		useSync.mockReturnValue({ sessionsCollection: sessions.collection })
		render(<WiredTaskNavigation taskId="task" sessionId="session" />)
		const row = await screen.findByRole('button', { name: /^Untitled session,/ })
		expect(screen.getByRole('heading', { name: 'Task name' })).toBeInTheDocument()
		act(() => sessions.update({ title: null, summary: 'Generated session summary' }))
		await waitFor(() => expect(row.querySelector('.t')).toHaveTextContent('Generated session summary'))
		expect(row).toHaveAttribute('title', 'Generated session summary · The agent finished')
		expect(row).toHaveAttribute('aria-current', 'page')
		act(() => sessions.update({ title: 'My session name', summary: 'A newer summary' }))
		await waitFor(() => expect(row.querySelector('.t')).toHaveTextContent('My session name'))
		expect(row).toHaveAttribute('title', 'My session name · The agent finished')
	})

	it('lists the newest session first', async () => {
		const session = (id: string, title: string): NavigationSession => ({
			id,
			task_id: 'task',
			title,
			summary: null,
			archived: false,
			status: 'ready_for_input',
			labels: [],
		})
		// useTask returns sessions oldest first.
		data.sessions = [session('older', 'Older session'), session('newer', 'Newer session')]
		const sync: SyncConfig<NavigationSession>['sync'] = ({ begin, write, commit, markReady }) => {
			begin()
			for (const value of data.sessions) write({ type: 'insert', value })
			commit()
			markReady()
			return { loadSubset: () => true }
		}
		const collection = createCollection({
			getKey: (row: NavigationSession) => row.id,
			syncMode: 'on-demand',
			sync: { sync },
		})
		useSync.mockReturnValue({ sessionsCollection: collection })
		render(<WiredTaskNavigation taskId="task" sessionId="older" />)
		await screen.findByRole('button', { name: /^Older session,/ })
		const rows = screen
			.getAllByRole('button', { name: /session,/ })
			.map((row) => row.querySelector('.t')?.textContent)
		expect(rows).toEqual(['Newer session', 'Older session'])
	})

	it('renames the task in place from the pencil after its title', async () => {
		data.sessions = []
		useSync.mockReturnValue({
			sessionsCollection: syncedSession({
				id: 'none',
				task_id: 'task',
				title: null,
				summary: null,
				archived: false,
				status: 'ready_for_input',
				labels: [],
			}).collection,
		})
		render(<WiredTaskNavigation taskId="task" />)
		expect(screen.getByRole('heading', { name: 'Task name' })).toBeInTheDocument()
		fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
		const field = screen.getByRole('textbox', { name: 'Task name' })
		expect(field).toHaveValue('Task name')
		expect(screen.queryByRole('dialog')).toBeNull()
		fireEvent.change(field, { target: { value: 'Renamed task' } })
		fireEvent.keyDown(field, { key: 'Enter' })
		await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Task name' })).toBeNull())
		expect(updateTask).toHaveBeenCalledWith({ taskId: 'task', name: 'Renamed task' })
	})

	it('cancels the rename with Escape', () => {
		data.sessions = []
		useSync.mockReturnValue({
			sessionsCollection: syncedSession({
				id: 'none',
				task_id: 'task',
				title: null,
				summary: null,
				archived: false,
				status: 'ready_for_input',
				labels: [],
			}).collection,
		})
		render(<WiredTaskNavigation taskId="task" />)
		fireEvent.click(screen.getByRole('button', { name: 'Rename task' }))
		fireEvent.keyDown(screen.getByRole('textbox', { name: 'Task name' }), { key: 'Escape' })
		expect(screen.getByRole('heading', { name: 'Task name' })).toBeInTheDocument()
		expect(updateTask).not.toHaveBeenCalled()
	})
})

// Vitest stubs CSS imports, so read the stylesheet itself.
const styles = readFileSync(join(import.meta.dirname, '../styles.css'), 'utf8')

/** The declarations of one top-level rule in the minimalist stylesheet. */
function cssRule(selector: string) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = styles.match(new RegExp(`\\n\\t${escaped} \\{([^}]*)\\}`))
	if (!match?.[1]) throw new Error(`No rule for ${selector}`)
	return match[1].replace(/\s+/g, ' ').trim()
}

describe('task navigation list layout', () => {
	it('puts Sessions and Artifacts on the first two rows of the lists area', () => {
		data.sessions = []
		useSync.mockReturnValue({
			sessionsCollection: syncedSession({
				id: 'none',
				task_id: 'task',
				title: null,
				summary: null,
				archived: false,
				status: 'ready_for_input',
				labels: [],
			}).collection,
		})
		render(<WiredTaskNavigation taskId="task" />)
		const groups = screen.getByRole('navigation', { name: 'Sessions and artifacts' })
		expect(groups).toHaveClass('task-nav-groups')
		expect([...groups.children].map((child) => child.getAttribute('aria-label'))).toEqual(['Sessions', 'Artifacts'])
	})

	// CORE-1899: with flex shrink, a long artifact list took room from a short session list in
	// proportion to their lengths, so a few sessions were cut off mid-row above Artifacts.
	it('shares spare room between the lists equally instead of shrinking them by length', () => {
		expect(cssRule('.task-nav-groups')).toContain('display: grid;')
		// Without a shrinkable column, the longest name would widen the lists past the panel.
		expect(cssRule('.task-nav-groups')).toContain('grid-template-columns: minmax(0, 1fr);')
		// Unset, --task-sessions-h voids grid-template-rows, so both lists get these equal-share rows.
		expect(cssRule('.task-nav-groups')).toContain(
			'grid-auto-rows: minmax(60px, auto) minmax(60px, auto) max-content;',
		)
		// Set, the first row is the sessions list's own height: the dragged size, stopped at its last
		// session, and leaving 150px for the artifacts and the task views.
		expect(cssRule('.task-nav-groups')).toContain(
			'grid-template-rows: min-content minmax(min(60px, var(--task-sessions-h)), auto) max-content;',
		)
		expect(cssRule('.task-nav-sessions')).toContain('height: min(var(--task-sessions-h), 100cqh - 150px);')
		expect(cssRule('.task-nav-sessions')).toContain('max-height: max-content;')
		expect(cssRule('.task-nav-groups')).toContain('align-content: start;')
		expect(cssRule('.task-nav-group')).not.toMatch(/flex(-shrink)?:/)
		// Changes and the pull request keep their full height in a short window.
		expect(cssRule('.task-nav-views')).not.toContain('min-height')
	})

	// A long artifact list could squeeze the sessions down to one row with no way to get them back.
	it('lets the sessions list be resized against the artifacts', () => {
		data.sessions = []
		useSync.mockReturnValue({
			sessionsCollection: syncedSession({
				id: 'none',
				task_id: 'task',
				title: null,
				summary: null,
				archived: false,
				status: 'ready_for_input',
				labels: [],
			}).collection,
		})
		render(
			<div className="minimalist-ui">
				<WiredTaskNavigation taskId="task" />
			</div>,
		)
		const sessions = screen.getByRole('region', { name: 'Sessions' })
		const handle = screen.getByRole('separator', { name: 'Resize sessions list' })
		expect(handle.parentElement).toBe(sessions)
		expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
		const root = handle.closest<HTMLElement>('.minimalist-ui')!
		// Like the stylesheet: the list follows the variable up to its 140px of sessions.
		vi.spyOn(sessions, 'getBoundingClientRect').mockImplementation(() => {
			const set = Number.parseFloat(root.style.getPropertyValue('--task-sessions-h'))
			return { height: Math.min(Number.isNaN(set) ? 100 : set, 140), width: 220 } as DOMRect
		})
		fireEvent.keyDown(handle, { key: 'ArrowDown' })
		expect(root.style.getPropertyValue('--task-sessions-h')).toBe('116px')
		expect(localStorage.getItem('hl-min-width-task-sessions')).toBe('116')
		fireEvent.keyDown(handle, { key: 'ArrowUp' })
		expect(root.style.getPropertyValue('--task-sessions-h')).toBe('100px')
		// Past the last session the size stops, so the way back starts there.
		fireEvent.keyDown(handle, { key: 'ArrowDown' })
		fireEvent.keyDown(handle, { key: 'ArrowDown' })
		fireEvent.keyDown(handle, { key: 'ArrowDown' })
		expect(root.style.getPropertyValue('--task-sessions-h')).toBe('140px')
		expect(localStorage.getItem('hl-min-width-task-sessions')).toBe('140')
		fireEvent.keyDown(handle, { key: 'ArrowUp' })
		expect(root.style.getPropertyValue('--task-sessions-h')).toBe('124px')
		fireEvent.doubleClick(handle)
		expect(root.style.getPropertyValue('--task-sessions-h')).toBe('')
		expect(localStorage.getItem('hl-min-width-task-sessions')).toBeNull()
	})
})
