import { describe, expect, test } from 'vitest'

import { deriveSidebarTabState, type SidebarTabStateInput } from './sidebar-tab-state'

const baseInput: SidebarTabStateInput = {
	activeTab: 'minimap',
	diffViewerEnabled: true,
	scratchPadEnabled: false,
	hasGithubPanel: false,
	hasDiffChildren: false,
	hasChangedFiles: false,
	taskId: 'task-1',
	todoCount: 0,
	artifactCount: 0,
	workflowPhaseCount: 0,
	hasPhaseTip: false,
	hasAutoAdvance: false,
	workspaceState: null,
	workspaceHosts: [],
}

const derive = (overrides: Partial<SidebarTabStateInput> = {}) => deriveSidebarTabState({ ...baseInput, ...overrides })

describe('deriveSidebarTabState', () => {
	test('reports minimap-only when no panel is available', () => {
		const state = derive()
		expect(state.isMinimapOnly).toBe(true)
		expect(state.effectiveTab).toBe('minimap')
	})

	test('a GitHub panel alone is enough to leave minimap-only', () => {
		const state = derive({ hasGithubPanel: true })
		expect(state.isMinimapOnly).toBe(false)
		expect(state.visibility.github).toBe(true)
	})

	test('GitHub follows Graph and Artifacts rather than leading the row', () => {
		const state = derive({ hasGithubPanel: true })
		const order = state.navItems.map((item) => item.value)
		expect(order.indexOf('github')).toBeGreaterThan(order.indexOf('graph'))
		expect(order.indexOf('github')).toBeGreaterThan(order.indexOf('artifacts'))
		expect(state.navItems.filter((item) => item.show).map((item) => item.value)).toContain('github')
	})

	const githubAttention = (state: ReturnType<typeof derive>) =>
		state.navItems.find((item) => item.value === 'github')?.attention

	test('puts the failing check count on the GitHub trigger and nowhere else', () => {
		const state = derive({ hasGithubPanel: true, githubFailingChecks: 3, artifactCount: 1 })
		expect(githubAttention(state)).toEqual({ kind: 'failing', count: 3 })
		expect(state.navItems.filter((item) => item.value !== 'github').every((item) => !item.attention)).toBe(true)
	})

	test('clears the badge once the checks pass', () => {
		const state = derive({ hasGithubPanel: true, githubFailingChecks: 0 })
		expect(githubAttention(state)).toBeUndefined()
	})

	test.each(['warning', 'accent'] as const)('draws the %s dot while the tab is shut', (attention) => {
		const state = derive({ hasGithubPanel: true, githubAttention: attention })
		expect(githubAttention(state)).toEqual({ kind: attention })
	})

	test('failing checks outrank the dot', () => {
		const state = derive({ hasGithubPanel: true, githubFailingChecks: 2, githubAttention: 'accent' })
		expect(githubAttention(state)).toEqual({ kind: 'failing', count: 2 })
	})

	test('an open GitHub tab carries no dot, but keeps its failing count', () => {
		expect(
			githubAttention(derive({ hasGithubPanel: true, activeTab: 'github', githubAttention: 'warning' })),
		).toBeUndefined()
		expect(
			githubAttention(
				derive({
					hasGithubPanel: true,
					activeTab: 'github',
					githubFailingChecks: 1,
					githubAttention: 'warning',
				}),
			),
		).toEqual({ kind: 'failing', count: 1 })
	})

	test('no attention when the store holds none', () => {
		expect(githubAttention(derive({ hasGithubPanel: true, githubAttention: null }))).toBeUndefined()
	})
	test.each([
		['the viewer is disabled', { diffViewerEnabled: false }],
		['there is no task', { taskId: null }],
		['the caller composed no diff children', { hasDiffChildren: false }],
		['nothing changed', { hasChangedFiles: false }],
	])('hides the diff tabs when %s', (_label, override) => {
		const state = derive({ hasDiffChildren: true, hasChangedFiles: true, ...override })
		expect(state.visibility.changes).toBe(false)
		expect(state.visibility.diffs).toBe(false)
	})

	test('shows the diff tabs when every gate holds', () => {
		const state = derive({ hasDiffChildren: true, hasChangedFiles: true })
		expect(state.visibility.changes).toBe(true)
		expect(state.visibility.diffs).toBe(true)
	})

	test('falls back off a tab that is no longer visible', () => {
		const state = derive({ activeTab: 'artifacts', artifactCount: 0, workflowPhaseCount: 2 })
		expect(state.effectiveTab).toBe('graph')
	})

	test('keeps the active tab when it is still visible', () => {
		const state = derive({ activeTab: 'artifacts', artifactCount: 3 })
		expect(state.effectiveTab).toBe('artifacts')
	})

	test('auto-advance replaces the minimap, tips and todos', () => {
		const state = derive({ hasAutoAdvance: true, hasPhaseTip: true, todoCount: 4 })
		expect(state.visibility['auto-advance']).toBe(true)
		expect(state.visibility.minimap).toBe(false)
		expect(state.visibility.tips).toBe(false)
		expect(state.visibility.todos).toBe(false)
		expect(state.effectiveTab).toBe('auto-advance')
	})

	test('synthesises one host from a legacy workspace snapshot', () => {
		const state = derive({
			workspaceState: {
				workspaceBaseDirectory: '/workspaces/demo',
				repos: [{ path: 'syncopate', sourceRef: 'origin/main', branch: 'feat/panel', primary: true }],
			},
		})
		expect(state.visibility.workspace).toBe(true)
		expect(state.workspaceHosts).toHaveLength(1)
		expect(state.workspaceHosts[0]?.hostId).toBe('unknown')
		expect(state.workspaceHosts[0]?.configured).toBe(false)
	})

	test('has no workspace tab without hosts or a snapshot', () => {
		expect(derive().visibility.workspace).toBe(false)
		expect(derive().workspaceHosts).toEqual([])
	})
})
