import type { WorkspaceSetupState } from '@humanlayer/schemas/effect/workspace'
import { describe, expect, test } from 'vitest'

import {
	calculateWorkspaceSetupElapsedTime,
	repoHasCompletedWorkspaceSetup,
	summarizeWorkspaceSetupProgressForDisplay,
	workspaceSetupForTaskOnHostHasCompleted,
	workspaceSetupStateAllowsSessionLaunch,
} from '@/lib/workspace/ledger'

function state(
	statuses: WorkspaceSetupState['repos'][number]['status'][],
	overrides: Partial<WorkspaceSetupState> = {},
): WorkspaceSetupState {
	return {
		specVersion: 1,
		repos: statuses.map((status, index) => ({ localPath: index === 0 ? '.' : `../repo-${index}`, status })),
		...overrides,
	}
}

describe('workspace setup ledger launch gating', () => {
	test('normal workspaces launch only after every repo advances past worktree', () => {
		expect(workspaceSetupStateAllowsSessionLaunch(state(['worktree', 'copy_globs']), null)).toBe(false)
		expect(workspaceSetupStateAllowsSessionLaunch(state(['copy_globs', 'setup_command']), null)).toBe(true)
	})

	test('blocking workspaces wait until every repo is done', () => {
		const blockingSpec = { setupBlocksFirstSession: true }
		expect(workspaceSetupStateAllowsSessionLaunch(state(['done', 'setup_command']), blockingSpec)).toBe(false)
		expect(workspaceSetupStateAllowsSessionLaunch(state(['done', 'done']), blockingSpec)).toBe(true)
	})

	test('accepted skips do not create a fake stage and use the advanced repo stage', () => {
		const skipped = state(['done'], {
			acceptedSkips: [
				{
					localPath: '.',
					stage: 'setup_command',
					skippedByUserId: 'user-1',
					skippedAt: 200,
				},
			],
		})

		expect(workspaceSetupStateAllowsSessionLaunch(skipped, { setupBlocksFirstSession: true })).toBe(true)
		expect(summarizeWorkspaceSetupProgressForDisplay(skipped).acceptedSkipCount).toBe(1)
	})

	test('row errors preserve gate semantics through the repo stage', () => {
		const beforeGate = state(['preflight'])
		const afterGate = state(['setup_command'])
		expect(workspaceSetupStateAllowsSessionLaunch(beforeGate, null)).toBe(false)
		expect(workspaceSetupStateAllowsSessionLaunch(afterGate, null)).toBe(true)
		expect(workspaceSetupStateAllowsSessionLaunch(afterGate, { setupBlocksFirstSession: true })).toBe(false)
	})

	test('empty workspaces are complete and ready', () => {
		const empty = state([])
		expect(workspaceSetupForTaskOnHostHasCompleted(empty)).toBe(true)
		expect(workspaceSetupStateAllowsSessionLaunch(empty, null)).toBe(true)
		expect(workspaceSetupStateAllowsSessionLaunch(empty, { setupBlocksFirstSession: true })).toBe(true)
	})
})

describe('workspace setup ledger display helpers', () => {
	test('reports completion, current stage, and elapsed time', () => {
		const setup = state(['done', 'copy_globs'], { startedAt: 100, finishedAt: 450 })
		const summary = summarizeWorkspaceSetupProgressForDisplay(setup)

		expect(repoHasCompletedWorkspaceSetup(setup.repos[0]!)).toBe(true)
		expect(workspaceSetupForTaskOnHostHasCompleted(setup)).toBe(false)
		expect(summary).toMatchObject({ totalRepos: 2, completedRepos: 1, currentStage: 'copy_globs' })
		expect(calculateWorkspaceSetupElapsedTime(setup, 1_000)).toBe(350)
	})

	test('returns null without a start and clamps clock skew', () => {
		expect(calculateWorkspaceSetupElapsedTime(state([]), 100)).toBeNull()
		expect(calculateWorkspaceSetupElapsedTime(state([], { startedAt: 200 }), 100)).toBe(0)
	})
})
