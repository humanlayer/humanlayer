import type { Session } from '@humanlayer/db/tables/sessions'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UiProvider } from '@/minimalist/lib/ui-state'

import { MinimalistTaskPage } from './TaskPage'

const { data, route, navigate, mounts } = vi.hoisted(() => ({
	data: { task: null as unknown, sessions: [] as Session[], artifacts: [] as unknown[], canSend: true },
	route: { search: {} as Record<string, unknown> },
	navigate: vi.fn(),
	mounts: vi.fn(),
}))
vi.mock('./TaskDetails', () => ({ WiredTaskDetails: () => null }))
vi.mock('@/minimalist/lib/auto-advance', () => ({
	useTaskAutoAdvance: () => ({ available: false, on: false, handOffs: [], toggle: vi.fn() }),
}))
vi.mock('@/minimalist/lib/pull-requests', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/minimalist/lib/pull-requests')>()),
	useTaskPullRequest: () => ({ branch: null }),
}))
vi.mock('@tanstack/react-router', () => ({
	useSearch: () => route.search,
	useNavigate: () => navigate,
	useLocation: ({ select }: { select: (location: unknown) => unknown }) => select({ state: {} }),
	Link: ({ children, to, search, ...props }: { children: ReactNode; to: string; search?: unknown }) => (
		<a href={to} data-search={JSON.stringify(search)} {...props}>
			{children}
		</a>
	),
}))
vi.mock('@/minimalist/lib/data', () => ({
	useTask: () => ({ task: data.task, sessions: data.sessions, isReady: true }),
	useSession: (id: string) => data.sessions.find((session) => session.id === id) ?? null,
	useTaskArtifacts: () => data.artifacts,
	canReview: (task: { workspace_id?: string | null }) => Boolean(task.workspace_id),
}))
vi.mock('@/minimalist/lib/access', () => ({ useSessionAccess: () => ({ canSendPrompt: data.canSend }) }))
vi.mock('@/components/diffs/TaskDiffScope', () => ({
	TaskDiffScope: ({ children }: { children: ReactNode }) => <div data-testid="diff-scope">{children}</div>,
}))
vi.mock('./ThreadView', () => ({
	ThreadView: ({ sessionId, visible }: { sessionId: string; visible: boolean }) => {
		const [draft, setDraft] = useState(() => {
			mounts(sessionId)
			return ''
		})
		return (
			<div data-testid="thread" data-visible={String(visible)}>
				<textarea
					aria-label={`Draft ${sessionId}`}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
				/>
			</div>
		)
	},
}))
vi.mock('./ArtifactPanel', () => ({
	ArtifactView: ({
		artifact,
		sessionId,
		focus,
	}: {
		artifact: { id: string }
		sessionId: string | null
		focus?: { comment?: string }
	}) => {
		const [draft, setDraft] = useState('')
		return (
			<div>
				Artifact {artifact.id}
				<output data-testid={`target-${artifact.id}`}>{sessionId ?? 'No recipient'}</output>
				<output>{focus?.comment}</output>
				<textarea
					aria-label={`Comment ${artifact.id}`}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
				/>
			</div>
		)
	},
}))
vi.mock('./PullRequestPanel', () => ({ PullRequestPanel: () => <div>PR details</div> }))
vi.mock('./ReviewPanel', () => ({ ReviewPanel: () => <div>Files and diffs</div>, useDiffTotals: () => null }))
vi.mock('./WorkspaceSetup', () => ({ WorkspaceSetup: () => <div>Workspace recovery</div> }))

function session(id: string, createdAt: number, activity: number, archived = false) {
	return {
		id,
		task_id: 'task',
		title: `${id} session`,
		created_at: createdAt,
		updated_at: activity,
		last_activity_at: activity,
		archived,
		status: 'ready_for_input',
		labels: [],
	} as unknown as Session
}

beforeEach(() => {
	localStorage.clear()
	vi.clearAllMocks()
	vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
	data.task = { id: 'task', name: 'Actual task title', workspace_id: 'workspace' }
	data.sessions = [session('first', 1, 30), session('second', 2, 20), session('archived', 3, 100, true)]
	data.artifacts = [
		{ id: 'prd', file_name: 'prd.md' },
		{ id: 'research', file_name: 'research.md' },
	]
	data.canSend = true
	route.search = {}
	navigate.mockImplementation(({ search }) => {
		route.search = search
		return Promise.resolve()
	})
})
afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

function openPage(sessionId?: string) {
	const tree = () => (
		<UiProvider>
			<MinimalistTaskPage taskId="task" sessionId={sessionId ?? (route.search.session as string | undefined)} />
		</UiProvider>
	)
	const view = render(tree())
	return {
		...view,
		update: () => view.rerender(tree()),
		click: (name: string) => {
			fireEvent.click(screen.getByRole('button', { name }))
			view.rerender(tree())
		},
	}
}

describe('task destinations', () => {
	it('provides the diff context used by a directory session while omitting unsupported task views', () => {
		data.task = { id: 'task', name: 'Directory task', workspace_id: null, workspace_state: null }
		openPage('first')
		expect(within(screen.getByTestId('diff-scope')).getByTestId('thread')).toBeInTheDocument()
		expect(screen.queryByRole('navigation', { name: 'Task views' })).toBeNull()
	})
	it('shows long session and artifact lists without a reveal menu', () => {
		data.sessions = Array.from({ length: 12 }, (_, index) => session(`session-${index}`, index, index))
		data.artifacts = Array.from({ length: 12 }, (_, index) => ({
			id: `artifact-${index}`,
			file_name: `document-${index}.md`,
		}))
		openPage()
		expect(within(screen.getByRole('region', { name: 'Sessions' })).getAllByRole('button')).toHaveLength(12)
		expect(within(screen.getByRole('region', { name: 'Artifacts' })).getAllByRole('button')).toHaveLength(12)
		expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
	})
	it('does not read a companion hidden in a narrow drawer until opened', () => {
		vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
		route.search = { artifactId: 'prd' }
		openPage('first')
		expect(screen.getByTestId('thread')).toHaveAttribute('data-visible', 'false')
		fireEvent.click(screen.getByRole('button', { name: 'Open session panel' }))
		expect(screen.getByTestId('thread')).toHaveAttribute('data-visible', 'true')
		fireEvent.click(screen.getByRole('button', { name: 'Close session panel' }))
		expect(screen.getByTestId('thread')).toHaveAttribute('data-visible', 'false')
	})
	it('keeps all active sessions and task artifacts one click away under the actual title', () => {
		openPage()
		expect(screen.getByRole('heading', { name: 'Actual task title' })).toBeInTheDocument()
		const sessions = within(screen.getByRole('region', { name: 'Sessions' }))
		const toggle = sessions.getByRole('button', { name: 'Archived sessions, 1' })
		expect(sessions.getAllByRole('button')).toHaveLength(3)
		expect(sessions.queryByRole('button', { name: /archived session,/ })).toBeNull()
		fireEvent.click(toggle)
		expect(toggle).toHaveAttribute('aria-expanded', 'true')
		expect(sessions.getByRole('button', { name: /archived session,/ })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'first session, The agent finished' })).toHaveAttribute(
			'aria-current',
			'page',
		)
	})
	it('moves the same session beside artifacts and preserves its draft and artifact comment drafts', () => {
		const view = openPage('first')
		fireEvent.change(screen.getByRole('textbox', { name: 'Draft first' }), {
			target: { value: 'Unsent follow-up' },
		})
		view.click('prd.md')
		expect(screen.getByRole('textbox', { name: 'Draft first' })).toHaveValue('Unsent follow-up')
		expect(screen.getByRole('textbox', { name: 'Draft first' }).closest('.task-thread')).toHaveClass('task-right')
		fireEvent.change(screen.getByRole('textbox', { name: 'Comment prd' }), { target: { value: 'Unsent comment' } })
		view.click('research.md')
		view.click('prd.md')
		expect(screen.getByRole('textbox', { name: 'Comment prd' })).toHaveValue('Unsent comment')
		view.click('first session, The agent finished, open in right panel')
		expect(screen.getByRole('textbox', { name: 'Draft first' }).closest('.task-thread')).toHaveClass('task-primary')
		expect(screen.getByRole('textbox', { name: 'Draft first' })).toHaveValue('Unsent follow-up')
		expect(mounts).toHaveBeenCalledOnce()
	})
	it('opens pull requests on the right, retains the artifact, and restores its session on close', () => {
		const view = openPage('first')
		view.click('prd.md')
		view.click('Pull requests')
		expect(screen.getByRole('main', { name: 'Artifact' })).toBeVisible()
		expect(screen.getByRole('complementary', { name: 'Pull requests' })).toBeVisible()
		expect(screen.getByTestId('thread')).toHaveAttribute('data-visible', 'false')
		view.click('Close pull request panel')
		expect(screen.getByTestId('thread')).toHaveAttribute('data-visible', 'true')
		expect(screen.queryByText('PR details')).toBeNull()
	})
	it('fills Changes beside both navigation panes and hides session or PR until another explicit selection', () => {
		const view = openPage('first')
		view.click('prd.md')
		view.click('Pull requests')
		view.click('Changes')
		expect(screen.getByRole('complementary', { name: 'Task navigation' })).toBeVisible()
		expect(screen.getByRole('main', { name: 'Changes' })).toBeVisible()
		expect(screen.queryByText('PR details')).toBeNull()
		expect(screen.getByTestId('thread')).toHaveAttribute('data-visible', 'false')
		view.click('Pull requests')
		expect(screen.getByText('PR details')).toBeVisible()
		expect(screen.getByRole('main', { name: 'Changes' })).toBeVisible()
	})
	it('honors artifact/comment and archived session links without sending comments to archived history', () => {
		route.search = { artifactId: 'prd', commentId: 'linked-comment' }
		openPage('archived')
		expect(screen.getByText('linked-comment')).toBeVisible()
		expect(screen.getByTestId('target-prd')).toHaveTextContent('No recipient')
		expect(screen.getByRole('textbox', { name: 'Draft archived' })).toBeVisible()
	})
	it('keeps zero-session tasks and artifact readers usable with workspace recovery and New session', () => {
		data.sessions = []
		const view = openPage()
		expect(screen.getByText('Workspace recovery')).toBeVisible()
		expect(screen.getAllByRole('link', { name: 'New session' })).toHaveLength(2)
		view.click('prd.md')
		expect(screen.getByRole('main', { name: 'Artifact' })).toBeVisible()
		expect(screen.getByTestId('target-prd')).toHaveTextContent('No recipient')
		expect(screen.queryByTestId('thread')).toBeNull()
	})
	it('keeps the selected recipient when switching artifacts and opening PR, and refuses a read-only recipient', () => {
		data.canSend = false
		const view = openPage('first')
		view.click('prd.md')
		expect(screen.getByTestId('target-prd')).toHaveTextContent('No recipient')
		data.canSend = true
		view.update()
		expect(screen.getByTestId('target-prd')).toHaveTextContent('first')
		view.click('research.md')
		expect(screen.getByTestId('target-research')).toHaveTextContent('first')
		view.click('Pull requests')
		expect(screen.getByTestId('target-research')).toHaveTextContent('first')
	})
})
