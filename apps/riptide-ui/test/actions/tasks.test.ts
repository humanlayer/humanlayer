import type { TaskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import type { Task } from '@humanlayer/db/tables/tasks'
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'
import { describe, expect, test, vi } from 'vitest'

import { createTaskActions } from '@/actions/tasks'

type TaskActionsParams = Parameters<typeof createTaskActions>
type TaskApi = TaskActionsParams[3]
type CreateTaskResponse = Awaited<ReturnType<TaskApi['tasks']['create']>>
type ReassignTaskOwnerResponse = Awaited<ReturnType<TaskApi['tasks']['reassignOwner']>>

function testCollection<T extends { id: string }>() {
	return createCollection(
		localOnlyCollectionOptions<T>({
			id: crypto.randomUUID(),
			getKey: (row) => row.id,
		}),
	)
}

function makeTask(id: string, name: string): Task {
	return {
		id,
		name,
		slug: null,
		default_working_directory: null,
		workspace_state: null,
		workspace_spec: null,
		organization_id: 'org-1',
		created_by: 'user-1',
		resource_owner_user_id: 'user-1',
		created_at: BigInt(Date.now()),
		updated_at: BigInt(Date.now()),
		archived: false,
		is_draft: false,
		setup_status: null,
		workflow_type: 'rpi',
		worktree_timing: 'later',
		setup_details: null,
		ticket_id: null,
		ticket_url: null,
		ticket_description: null,
		ticket_provider: null,
		github_connection_id: null,
		ticket_repository_id: null,
		ticket_repository_full_name: null,
		auto_advance_questions_to_research: false,
		auto_advance_research_to_design: false,
		auto_advance_plan_to_worktree: false,
		auto_advance_worktree_to_implementation: false,
		auto_advance_implementation_to_pr: false,
		slack_notifications_muted: false,
		team_id: null,
		project_id: null,
		external_task_id: null,
	}
}

function makeApi(create: TaskApi['tasks']['create']): TaskApi {
	return {
		tasks: {
			create,
			createDraft: vi.fn<TaskApi['tasks']['createDraft']>(),
			update: vi.fn<TaskApi['tasks']['update']>(),
			archive: vi.fn<TaskApi['tasks']['archive']>(),
			reassignOwner: vi.fn<TaskApi['tasks']['reassignOwner']>(),
		},
	}
}

function makeActions(
	create: TaskApi['tasks']['create'],
	confirmTask: TaskActionsParams[4],
	confirmSession: TaskActionsParams[5],
) {
	return createTaskActions(
		testCollection<Task>(),
		{ update: () => undefined },
		testCollection<TaskOrganizationAcl>(),
		makeApi(create),
		confirmTask,
		confirmSession,
	)
}

describe('createTask atomic sync confirmation', () => {
	test('confirms task and first session with the transaction returned by task creation', async () => {
		const response: CreateTaskResponse = {
			result: 'created',
			transactionId: 'task-and-session-tx',
			firstSessionId: 'session-1',
			task: makeTask('task-1', 'Atomic task'),
		}
		const create: TaskApi['tasks']['create'] = vi.fn(async () => response)
		const confirmTask = vi.fn(async () => {})
		const confirmSession = vi.fn(async () => {})
		const actions = makeActions(create, confirmTask, confirmSession)

		const transaction = actions.createTask({
			id: 'task-1',
			userId: 'user-1',
			dbOrganizationId: 'org-1',
			name: 'Atomic task',
			firstSession: {
				title: 'First session',
				text: 'Start',
				workingDirectory: '/repo',
				hostId: 'host-1',
				codingAgent: 'claude',
				provider: 'anthropic',
				model: 'opus',
				permissionsMode: 'default',
			},
		})

		await transaction.isPersisted.promise

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ firstSession: expect.objectContaining({ title: 'First session' }) }),
		)
		expect(confirmTask).toHaveBeenCalledWith('task-and-session-tx')
		expect(confirmSession).toHaveBeenCalledWith('task-and-session-tx')
	})

	test('does not wait for a session confirmation when no first session exists', async () => {
		const response: CreateTaskResponse = {
			result: 'created',
			transactionId: 'task-only-tx',
			firstSessionId: null,
			task: makeTask('task-2', 'Task only'),
		}
		const create: TaskApi['tasks']['create'] = vi.fn(async () => response)
		const confirmTask = vi.fn(async () => {})
		const confirmSession = vi.fn(async () => {})
		const actions = makeActions(create, confirmTask, confirmSession)

		await actions.createTask({
			id: 'task-2',
			userId: 'user-1',
			dbOrganizationId: 'org-1',
			name: 'Task only',
		}).isPersisted.promise

		expect(confirmTask).toHaveBeenCalledWith('task-only-tx')
		expect(confirmSession).not.toHaveBeenCalled()
	})
})

describe('reassignTaskOwner sync confirmation', () => {
	test('waits for the task source-of-truth collection before persisting', async () => {
		const api = makeApi(vi.fn<TaskApi['tasks']['create']>())
		const response: ReassignTaskOwnerResponse = {
			taskId: '01910c93-7b8a-7ef1-8000-000000000001',
			previousOwnerUserId: 'old-owner',
			newOwnerUserId: 'new-owner',
			transactionId: 'owner-tx',
		}
		api.tasks.reassignOwner = vi.fn(async () => response)
		const confirmations = {
			tasks: vi.fn(async () => {}),
			sessions: vi.fn(async () => {}),
			conversationEvents: vi.fn(async () => {}),
			approvals: vi.fn(async () => {}),
			queuedMessages: vi.fn(async () => {}),
			artifacts: vi.fn(async () => {}),
			artifactsMetadata: vi.fn(async () => {}),
			artifactComments: vi.fn(async () => {}),
			diffComments: vi.fn(async () => {}),
			taskUserAcls: vi.fn(async () => {}),
			taskOrganizationAcls: vi.fn(async () => {}),
		}
		const tasksCollection = testCollection<Task>()
		tasksCollection.insert(makeTask(response.taskId, 'Ownership task'))
		const actions = createTaskActions(
			tasksCollection,
			{ update: () => undefined },
			testCollection<TaskOrganizationAcl>(),
			api,
			confirmations.tasks,
			confirmations.sessions,
			confirmations,
		)

		await actions.reassignTaskOwner({
			taskId: response.taskId,
			newOwnerUserId: response.newOwnerUserId,
		}).isPersisted.promise

		expect(api.tasks.reassignOwner).toHaveBeenCalledWith({
			taskId: response.taskId,
			newOwnerUserId: response.newOwnerUserId,
		})
		expect(confirmations.tasks).toHaveBeenCalledWith('owner-tx')
		for (const confirmTransaction of Object.values(confirmations).filter(
			(confirmTransaction) => confirmTransaction !== confirmations.tasks,
		)) {
			expect(confirmTransaction).not.toHaveBeenCalled()
		}
	})
})
