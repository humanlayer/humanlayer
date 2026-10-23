import { describe, expect, it, vi } from 'vitest'

import { createLauncherV3DefaultValues, toLaunchCommand } from './launcher-v3-form'
import { buildCreateTaskV2Input, launchTask, type LauncherV3LaunchDependencies } from './launcher-v3-launch'
import {
	LAUNCHER_V3_EVENT_ID as EVENT_ID,
	LAUNCHER_V3_PROJECT_ID as PROJECT_ID,
	LAUNCHER_V3_SESSION_ID as SESSION_ID,
	LAUNCHER_V3_TASK_ID as TASK_ID,
	launcherV3Command as command,
	launcherV3ProjectLaunch as projectLaunch,
} from './launcher-v3-test-fixtures'

function launchResult() {
	return {
		outcome: 'created' as const,
		taskId: TASK_ID,
		firstSessionId: SESSION_ID,
		transactionId: 'tx-1',
		task: { id: TASK_ID } as never,
	}
}

function createV2Result() {
	return {
		result: 'created' as const,
		taskId: TASK_ID,
		workspaceId: TASK_ID,
		sessionId: SESSION_ID,
		transactionId: 'tx-2',
	}
}

function harness(
	options: Partial<{
		launchDraft: LauncherV3LaunchDependencies['tasks']['launchDraft']
		createV2: LauncherV3LaunchDependencies['tasks']['createV2']
		waitForTask: LauncherV3LaunchDependencies['tasks']['waitForTask']
		waitForSession: LauncherV3LaunchDependencies['tasks']['waitForSession']
	}> = {},
) {
	const launchDraft = vi.fn<LauncherV3LaunchDependencies['tasks']['launchDraft']>(
		options.launchDraft ?? (async () => launchResult()),
	)
	const createV2 = vi.fn<LauncherV3LaunchDependencies['tasks']['createV2']>(
		options.createV2 ?? (async () => createV2Result()),
	)
	const waitForTask = vi.fn<LauncherV3LaunchDependencies['tasks']['waitForTask']>(
		options.waitForTask ?? (async () => {}),
	)
	const waitForSession = vi.fn<LauncherV3LaunchDependencies['tasks']['waitForSession']>(
		options.waitForSession ?? (async () => {}),
	)
	const report = vi.fn<LauncherV3LaunchDependencies['operations']['report']>()
	return {
		dependencies: { tasks: { launchDraft, createV2, waitForTask, waitForSession }, operations: { report } },
		launchDraft,
		createV2,
		waitForTask,
		waitForSession,
		report,
	}
}

function attempt(overrides: Partial<LauncherV3Command> = {}) {
	return { command: command(overrides), ids: { taskId: TASK_ID, firstSessionId: SESSION_ID, firstEventId: EVENT_ID } }
}

describe('launchTask with a project', () => {
	it('creates a V2 task with the shared task/workspace identity and skips launchDraft', async () => {
		const run = harness()

		const result = await launchTask(attempt({ project: projectLaunch(), directory: '' }), run.dependencies)

		expect(run.launchDraft).not.toHaveBeenCalled()
		expect(run.createV2).toHaveBeenCalledOnce()
		const input = run.createV2.mock.calls[0]![0]
		expect(input).toMatchObject({
			taskId: TASK_ID,
			workspaceId: TASK_ID,
			sessionId: SESSION_ID,
			eventId: EVENT_ID,
			projectId: PROJECT_ID,
			name: 'Launcher V3',
			slug: 'launcher-v3',
			defaultRepositoryIdentity: 'github.com/humanlayer/syncopate',
			taskContent: 'Build the plain launcher',
			ticketDescription: 'Build the plain launcher',
			workflowType: 'freeform',
			firstSession: {
				id: SESSION_ID,
				eventId: EVENT_ID,
				text: 'Build the plain launcher',
				hostId: 'host-1',
				codingAgent: 'claude',
				model: 'opus',
				permissionsMode: 'auto',
			},
		})
		expect(input.repositories[0]?.branch).toBe('launcher-v3')
		expect(run.report.mock.calls.map(([operation]) => operation.phase)).toEqual([
			'building-request',
			'creating-task',
			'confirming-sync',
		])
		expect(result).toMatchObject({ taskId: TASK_ID, sessionId: SESSION_ID, transactionId: 'tx-2' })
		expect(result.task).toBeUndefined()
		expect(result.navigation).toEqual({
			to: '/tasks/$taskId',
			params: { taskId: TASK_ID },
			search: { focus: 'workspace' },
			replace: true,
		})
	})

	it('carries the workflow prompt and attachments into the V2 request', () => {
		const input = buildCreateTaskV2Input({
			command: {
				...command({
					workflowType: 'prd_tdd',
					attachments: [
						{
							fileName: 'spec.md',
							contentType: 'text/markdown',
							fileSizeBytes: 3,
							contentHash: 'a'.repeat(64),
						},
					],
				}),
				project: projectLaunch(),
			},
			ids: { taskId: TASK_ID, firstSessionId: SESSION_ID, firstEventId: EVENT_ID },
		})
		expect(input.attachments).toHaveLength(1)
		expect(input.taskContent).toContain('@.humanlayer/tasks/launcher-v3/spec.md')
		expect(input.workflowType).toBe('prd_tdd')
		expect(input.firstSession.text).not.toBe('Build the plain launcher')
	})

	it('starts a small task on implementation and asks it to offer describe-pr', () => {
		const input = buildCreateTaskV2Input({
			command: {
				...command({ workflowType: 'freeform', directImplementation: true }),
				project: projectLaunch(),
			},
			ids: { taskId: TASK_ID, firstSessionId: SESSION_ID, firstEventId: EVENT_ID },
		})
		expect(input.firstSession.intent).toBe('implementation')
		expect(input.firstSession.text).toContain('```\n/rpi:describe-pr\n```')
		expect(input.taskContent).toContain('/rpi:describe-pr')
	})
})

describe('launchTask', () => {
	it.each(['project', 'directory'] as const)(
		'sends PR-only Freeform auto-advance through the %s request preserving prompt and permissions',
		async (destination) => {
			const run = harness()
			const launchCommand = toLaunchCommand(
				createLauncherV3DefaultValues({
					prompt: 'Build the plain launcher',
					title: 'Launcher V3',
					slug: 'launcher-v3',
					hostId: 'host-1',
					directory: '/repo/syncopate',
					workflowType: 'freeform',
					autoAdvance: true,
					permissionsMode: 'accept_edits',
				}),
			)
			await launchTask(
				attempt({ ...launchCommand, ...(destination === 'project' ? { project: projectLaunch() } : {}) }),
				run.dependencies,
			)

			const request = destination === 'project' ? run.createV2 : run.launchDraft
			expect(request).toHaveBeenCalledOnce()
			expect(destination === 'project' ? run.launchDraft : run.createV2).not.toHaveBeenCalled()
			expect(request.mock.calls[0]![0]).toMatchObject({
				workflowType: 'freeform',
				taskContent: 'Build the plain launcher',
				ticketDescription: 'Build the plain launcher',
				autoAdvanceQuestionsToResearch: false,
				autoAdvanceResearchToDesign: false,
				autoAdvancePlanToWorktree: false,
				autoAdvanceWorktreeToImplementation: false,
				autoAdvanceImplementationToPr: true,
				firstSession: { text: 'Build the plain launcher', permissionsMode: 'accept_edits' },
			})
		},
	)

	it('submits one durable launch command with stable task, session, and event identities', async () => {
		const run = harness()

		const result = await launchTask(attempt(), run.dependencies)

		expect(run.launchDraft).toHaveBeenCalledWith({
			draftId: TASK_ID,
			name: 'Launcher V3',
			slug: 'launcher-v3',
			defaultWorkingDirectory: '/repo/syncopate',
			taskContent: 'Build the plain launcher',
			ticketDescription: 'Build the plain launcher',
			firstSession: {
				id: SESSION_ID,
				eventId: EVENT_ID,
				title: 'Launcher V3',
				text: 'Build the plain launcher',
				workingDirectory: '/repo/syncopate',
				hostId: 'host-1',
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'opus',
				effort: 'high',
				fastMode: false,
				permissionsMode: 'auto',
			},
			workflowType: 'freeform',
			worktreeTiming: 'never',
			autoAdvanceQuestionsToResearch: false,
			autoAdvanceResearchToDesign: false,
			autoAdvancePlanToWorktree: false,
			autoAdvanceWorktreeToImplementation: false,
			autoAdvanceImplementationToPr: false,
		})
		expect(run.waitForTask).not.toHaveBeenCalled()
		expect(run.waitForSession).not.toHaveBeenCalled()
		expect(result.navigation).toEqual({ to: '/tasks/$taskId', params: { taskId: TASK_ID }, replace: true })
	})

	it('uses the task title for a freeform first session', async () => {
		const run = harness()

		await launchTask(attempt({ title: 'Fix composer session titles' }), run.dependencies)

		expect(run.launchDraft).toHaveBeenCalledWith(
			expect.objectContaining({
				firstSession: expect.objectContaining({ title: 'Fix composer session titles' }),
			}),
		)
	})

	it('opens the workspace tab when immediate legacy workspace setup is requested', async () => {
		const run = harness()
		const workspaceSpec = { repos: [], workspaceBaseDirectory: '/workspaces/task' } as never

		const result = await launchTask(attempt({ worktreeTiming: 'now', workspaceSpec }), run.dependencies)

		expect(result.navigation.search).toEqual({ focus: 'workspace' })
	})

	it('keeps workflow, attachment, and ticket metadata in the launch command', async () => {
		const run = harness()
		const attachments = [
			{ fileName: 'notes.txt', contentType: 'text/plain', fileSizeBytes: 5, contentHash: 'a'.repeat(64) },
		]

		await launchTask(
			attempt({
				workflowType: 'prd_tdd',
				worktreeTiming: 'later',
				attachments,
				ticket: {
					provider: 'github',
					ticketId: '42',
					name: '[acme/web#42] Fix launch stalls',
					slug: 'acme-web-42-fix-launch-stalls',
					url: 'https://github.com/acme/web/issues/42',
					githubRepository: {
						connectionId: '11111111-1111-4111-8111-111111111111',
						repositoryId: '77',
						fullName: 'acme/web',
						accountLogin: 'acme',
						private: false,
						archived: false,
					},
				},
			}),
			run.dependencies,
		)

		expect(run.launchDraft).toHaveBeenCalledWith(
			expect.objectContaining({
				workflowType: 'prd_tdd',
				worktreeTiming: 'later',
				attachments,
				ticketProvider: 'github',
				ticketId: '42',
				githubConnectionId: '11111111-1111-4111-8111-111111111111',
				ticketRepositoryId: '77',
				ticketRepositoryFullName: 'acme/web',
				firstSession: expect.objectContaining({
					text: 'use the rpi:create-research-questions skill for .humanlayer/tasks/launcher-v3',
				}),
			}),
		)
	})

	it('does not begin confirmation after a rejected launch request', async () => {
		const failure = new Error('request rejected before commit')
		const run = harness({ launchDraft: async () => Promise.reject(failure) })

		await expect(launchTask(attempt(), run.dependencies)).rejects.toBe(failure)
		expect(run.waitForTask).not.toHaveBeenCalled()
		expect(run.waitForSession).not.toHaveBeenCalled()
	})

	it('keeps progress reporting observational', async () => {
		const run = harness()
		run.report.mockImplementation((operation) => {
			if (operation.phase === 'confirming-sync') throw new Error('progress UI detached')
		})

		await expect(launchTask(attempt(), run.dependencies)).resolves.toMatchObject({ taskId: TASK_ID })
	})
})
