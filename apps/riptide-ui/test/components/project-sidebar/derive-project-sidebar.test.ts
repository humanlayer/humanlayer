import { describe, expect, test } from 'vitest'

import {
	deriveProjectSidebar,
	isEligibleSession,
	projectSidebarNavigation,
	type ProjectTaskInput,
	type SidebarProject,
	type WorkspaceStatus,
	type WorkspaceRead,
} from '@/components/project-sidebar/derive-project-sidebar'
import type { SidebarSessionRow } from '@/components/sidebar-task-tree/useSidebarTaskTreeQuery'
import { emptyProjectSidebarOrder } from '@/hooks/stores/projectSidebarStore'

export const project = (id: string, overrides: Partial<SidebarProject> = {}): SidebarProject => ({
	id,
	name: id,
	organizationId: 'org',
	description: null,
	private: false,
	createdBy: 'me',
	resourceOwnerUserId: 'me',
	repositories: [],
	archived: false,
	createdAt: 1,
	updatedAt: 1,
	...overrides,
})
export const task = (id: string, workspaceId: string | null = null): ProjectTaskInput => ({
	taskId: id,
	taskName: id,
	workspaceId,
	ownerUserId: 'me',
	taskCreatedAt: 1n,
	taskUpdatedAt: 1n,
	sessionCount: 0,
	latestSessionActivity: null,
})
export const session = (id: string, status: string, age: number, taskId = 'task'): SidebarSessionRow => ({
	sessionId: id,
	taskId,
	ownerUserId: 'me',
	hostId: 'host',
	sessionName: id,
	sessionTitle: null,
	sessionStatus: status,
	sessionCreatedAt: BigInt(age),
	sessionLastActivityAt: BigInt(age),
	messageCount: 0,
	labels: [],
})
export const workspace = (projectId: string): WorkspaceRead => ({
	state: 'ready',
	data: { workspace: { projectId }, materializations: [] } as unknown as WorkspaceStatus,
})
const defaults = () => ({
	tasks: [task('task')],
	sessions: [] as SidebarSessionRow[],
	projects: [] as SidebarProject[],
	workspaces: new Map<string, WorkspaceRead>(),
	unread: new Set<string>(),
	order: emptyProjectSidebarOrder(),
})

describe('project sidebar projection', () => {
	test('groups all tasks exactly once, including shared/archived projects, V1 and unresolved relations; no global 20 cap', () => {
		const input = defaults()
		input.projects = [
			project('owned'),
			project('shared', { resourceOwnerUserId: 'teammate' }),
			project('archived', { archived: true }),
			project('empty'),
		]
		input.tasks = Array.from({ length: 24 }, (_, index) => task(`t${index}`, `w${index}`))
		for (const [index, item] of input.tasks.entries())
			input.workspaces.set(item.taskId, workspace(index % 2 ? 'shared' : 'owned'))
		input.tasks.push(task('archived', 'w'), task('v1'), task('directory'), task('unresolved', 'missing'))
		input.workspaces.set('archived', workspace('archived'))
		input.workspaces.set('unresolved', workspace('unavailable'))
		const result = deriveProjectSidebar(input)
		expect(result.groups.map((group) => group.id)).toEqual(['archived', 'owned', 'shared', 'other'])
		expect(result.groups.flatMap((group) => group.tasks)).toHaveLength(28)
		expect(new Set(result.groups.flatMap((group) => group.tasks.map((row) => row.id))).size).toBe(28)
		expect(result.groups.at(-1)?.tasks.map((row) => row.id)).toEqual(['v1', 'directory', 'unresolved'])
		expect(result.groups.at(-1)?.tasks.at(-1)?.unresolvedProject).toBe(true)
		expect(result.emptyProjects.map((item) => item.id)).toEqual(['empty'])
	})

	test('pending/error workspace relations are not classified as directory tasks', () => {
		const result = deriveProjectSidebar({
			...defaults(),
			tasks: [task('pending', 'w1'), task('error', 'w2'), task('missing', 'w3')],
			workspaces: new Map([
				['error', { state: 'error' }],
				['missing', { state: 'missing' }],
			]),
		})
		expect(result.pendingRelations).toBe(true)
		expect(result.failedRelations).toBe(true)
		expect(result.groups.find((group) => group.id === 'other')?.tasks.map((item) => item.id)).toEqual(['missing'])
		expect(result.groups.flatMap((group) => group.tasks)).toHaveLength(3)
	})

	test.each([
		'running',
		'needs_approval',
		'failed',
		'lost',
		'launching',
		'ready_for_launch',
		'resuming',
		'interrupt_requested',
	])('maps %s to eligibility', (status) => {
		expect(isEligibleSession(session('s', status, 1), new Set(), false)).toBe(true)
	})

	test('unread and workspace setup qualify, idle/read and drafts do not', () => {
		expect(isEligibleSession(session('s', 'ready_for_input', 1), new Set(['s']), false)).toBe(true)
		expect(isEligibleSession(session('s', 'ready_for_input', 1), new Set(), true)).toBe(true)
		expect(isEligibleSession(session('s', 'ready_for_input', 1), new Set(), false)).toBe(false)
		expect(isEligibleSession(session('s', 'draft', 1), new Set(['s']), true)).toBe(false)
	})

	test('filters before the five-total cap, without duplicating overlapping conditions, and aggregates the full set', () => {
		const result = deriveProjectSidebar({
			...defaults(),
			tasks: [{ ...task('task'), sessionCount: 10 }],
			unread: new Set(['running', 'unread']),
			sessions: [
				session('idle-selected', 'ready_for_input', 100),
				session('idle2', 'interrupted', 99),
				session('running', 'running', 90),
				session('unread', 'ready_for_input', 80),
				session('failed', 'failed', 70),
				session('lost', 'lost', 60),
				session('launch', 'launching', 50),
				session('approval', 'needs_approval', 40),
			],
		})
		const row = result.groups[0]!.tasks[0]!
		expect(row.sessions.map((item) => item.id)).toEqual(['running', 'unread', 'failed', 'lost', 'launch'])
		expect(row.historySessions?.map((item) => item.id)).toEqual([
			'idle-selected',
			'idle2',
			'running',
			'unread',
			'failed',
			'lost',
			'launch',
			'approval',
		])
		expect(row.status).toBe('needs_approval')
		expect(row.allSessionIds).toHaveLength(8)
		expect(row.sessionCount).toBe(10)
	})

	test('workspace setup is host/owner specific and maps to existing pending/launching indicators', () => {
		const read = workspace('p') as { state: 'ready'; data: WorkspaceStatus }
		read.data.materializations = [
			{ hostId: 'host', userId: 'me', repositories: [{ status: { status: 'materializing', error: null } }] },
		] as WorkspaceStatus['materializations']
		const result = deriveProjectSidebar({
			...defaults(),
			tasks: [task('task', 'w')],
			projects: [project('p')],
			workspaces: new Map([['task', read]]),
			sessions: [
				session('setup', 'ready_for_input', 1),
				{ ...session('remote', 'ready_for_input', 2), hostId: 'another-host' },
			],
		})
		expect(result.groups[0]!.tasks[0]!.sessions.map((s) => [s.id, s.status])).toEqual([['setup', 'launching']])
		expect(result.groups[0]!.tasks[0]!.status).toBe('pending')
	})

	test('keeps zero-eligible tasks and full unread aggregate beyond the cap', () => {
		const result = deriveProjectSidebar({
			...defaults(),
			tasks: [task('idle'), task('task')],
			unread: new Set(['old']),
			sessions: [
				...Array.from({ length: 5 }, (_, index) => session(`s${index}`, 'running', index + 1)),
				session('old', 'ready_for_input', 0),
				session('idle', 'ready_for_input', 1, 'idle'),
			],
		})
		expect(result.groups[0]!.tasks[0]!.sessions).toEqual([])
		expect(result.groups[0]!.tasks[1]!.isUnread).toBe(true)
		expect(result.groups[0]!.tasks[1]!.sessions).toHaveLength(5)
	})

	test('navigation follows rendered saved project/task order and only expanded eligible children', () => {
		const result = deriveProjectSidebar({
			...defaults(),
			tasks: [task('one', 'w'), task('two', 'w'), task('three', 'w')],
			projects: [project('a'), project('b')],
			workspaces: new Map([
				['one', workspace('a')],
				['two', workspace('a')],
				['three', workspace('b')],
			]),
			sessions: [session('child', 'running', 1, 'two')],
			order: { projects: ['b', 'a'], tasks: { a: ['two', 'one'] } },
		})
		const tasks = result.groups.flatMap((group) => group.tasks)
		expect(projectSidebarNavigation(tasks, ['two'], ['standalone']).map((item) => item.id)).toEqual([
			'three',
			'two',
			'child',
			'one',
			'standalone',
		])
		expect(projectSidebarNavigation(tasks, [], []).map((item) => item.id)).toEqual(['three', 'two', 'one'])
	})
})
