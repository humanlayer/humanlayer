import { homedir } from 'node:os'
import { join } from 'node:path'

import { deriveWorkspaceView, type WorkspaceView } from '@humanlayer/db/utils/workspace-view'
import type { WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { describe, expect, test } from 'vitest'

import {
	expandedWorkspaceBaseDirectory,
	workspaceRepoDirectories,
} from '../../../src/lib/workspace/render-workspace-information'

const BASE = '/users/test/.humanlayer/workspaces/core-1349-multi-repo'

function createState(overrides: Partial<WorkspaceState> = {}): WorkspaceView {
	const legacyWorkspaceState = {
		workspaceBaseDirectory: BASE,
		repos: [
			{
				path: 'syncopate',
				description: 'HumanLayer monorepo',
				sourceRef: 'HEAD',
				branch: 'core-1349-syncopate',
				primary: true,
			},
			{
				path: 'agentlayer',
				description: 'AgentLayer SDK',
				sourceRef: 'origin/main',
				branch: 'core-1349-agentlayer',
				primary: false,
			},
			{
				path: 'metalytics',
				sourceRef: 'origin/main',
				branch: 'core-1349-metalytics',
				primary: false,
			},
		],
		...overrides,
	}
	const workspaceView = deriveWorkspaceView({ workspaceSpec: null, legacyWorkspaceState })
	if (!workspaceView) throw new Error('Expected legacy workspace fixture to resolve')
	return workspaceView
}

describe('expandedWorkspaceBaseDirectory', () => {
	test('expands a leading tilde against the local home directory', () => {
		const state = createState({ workspaceBaseDirectory: '~/.humanlayer/workspaces/slug' })
		expect(expandedWorkspaceBaseDirectory(state)).toBe(join(homedir(), '.humanlayer', 'workspaces', 'slug'))
	})

	test('passes absolute paths through unchanged', () => {
		expect(expandedWorkspaceBaseDirectory(createState())).toBe(BASE)
	})
})

describe('workspaceRepoDirectories', () => {
	test('excludes the cwd repo and preserves config order', () => {
		const dirs = workspaceRepoDirectories(createState(), join(BASE, 'syncopate'))
		expect(dirs).toEqual([join(BASE, 'agentlayer'), join(BASE, 'metalytics')])
	})

	test('includes every repo when launched at the workspace root', () => {
		const dirs = workspaceRepoDirectories(createState(), BASE)
		expect(dirs).toEqual([join(BASE, 'syncopate'), join(BASE, 'agentlayer'), join(BASE, 'metalytics')])
	})

	test('expands a tilde base directory before joining repo paths', () => {
		const state = createState({ workspaceBaseDirectory: '~/.humanlayer/workspaces/slug' })
		const expandedBase = join(homedir(), '.humanlayer', 'workspaces', 'slug')
		const dirs = workspaceRepoDirectories(state, join(expandedBase, 'agentlayer'))
		expect(dirs).toEqual([join(expandedBase, 'syncopate'), join(expandedBase, 'metalytics')])
	})
})
