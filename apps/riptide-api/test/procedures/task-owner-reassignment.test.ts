import { tmpdir } from 'node:os'

import { describe, it } from '@effect/vitest'
import { aclOperationsLog } from '@humanlayer/db/tables/acl-operations-log'
import { approvals } from '@humanlayer/db/tables/approvals'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import { PostgresDbLive } from '../../src/effects/services/postgres/postgres-db.service'
import { WorkosService } from '../../src/effects/services/workos/workos.service'
import { reassignTaskOwner } from '../../src/effects/task-owner-reassignment/reassign-task-owner'
import {
	TaskOwnerReassignmentForbiddenError,
	TaskOwnerDatabaseFailureError,
	TaskOwnerRecipientIneligibleError,
	TaskOwnerRecipientUnchangedError,
	TaskOwnerTaskNotFoundError,
} from '../../src/effects/task-owner-reassignment/task-owner-reassignment.errors'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const ownerUserId = 'user_owner'
const newOwnerUserId = 'user_new_owner'
const editorUserId = 'user_editor'
const adminUserId = 'user_admin'
const workosOrganizationId = 'org_task_owner_reassignment'

describe('task owner reassignment', () => {
	let db: PostgresJsDatabase
	let organizationId: string
	let cleanup: (() => Promise<void>) | undefined

	beforeAll(async () => {
		const testDb = await createTestDb('task_owner_reassignment')
		db = testDb.db
		cleanup = testDb.cleanup
		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Owner reassignment tests', workos_organization_id: workosOrganizationId })
			.returning()
		if (!organization) throw new Error('Failed to create test organization')
		organizationId = organization.id
	}, 30_000)

	afterAll(async () => {
		await cleanup?.()
	}, 30_000)

	const activeWorkosService: typeof WorkosService.Service = {
		createUserApiKey: () => Effect.die('Unexpected WorkOS call'),
		listUserApiKeys: () => Effect.die('Unexpected WorkOS call'),
		validateApiKey: () => Effect.die('Unexpected WorkOS call'),
		deleteApiKey: () => Effect.die('Unexpected WorkOS call'),
		listActiveAdmins: () => Effect.die('Unexpected WorkOS call'),
		sendInvitation: () => Effect.die('Unexpected WorkOS call'),
		getUser: () => Effect.die('Unexpected WorkOS call'),
		hasPendingInvitation: () => Effect.die('Unexpected WorkOS call'),
		countActiveOrganizationMemberships: () => Effect.die('Unexpected WorkOS call'),
		countPendingInvitations: () => Effect.die('Unexpected WorkOS call'),
		listUsersByEmail: () => Effect.die('Unexpected WorkOS call'),
		listActiveOrganizationMemberships: ({ userId, organizationId: requestedOrganizationId, limit }) =>
			userId === newOwnerUserId && requestedOrganizationId === workosOrganizationId && limit === 1
				? Effect.succeed([{ userId, organizationId: requestedOrganizationId }])
				: Effect.succeed([]),
	}
	const activeMembershipLayer = Layer.succeed(WorkosService, activeWorkosService)

	const runReassignment = (input: {
		readonly taskId: string
		readonly actingUserId?: string
		readonly newOwnerId?: string
		readonly isAdmin?: boolean
	}) =>
		reassignTaskOwner({
			taskId: input.taskId,
			newOwnerUserId: input.newOwnerId ?? newOwnerUserId,
			actingUserId: input.actingUserId ?? ownerUserId,
			organizationId,
			workosOrganizationId,
			actingUserIsOrganizationAdmin: input.isAdmin ?? false,
		}).pipe(Effect.provide(Layer.merge(PostgresDbLive(db), activeMembershipLayer)))

	const createTask = async (name: string) => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name,
				created_by: ownerUserId,
				resource_owner_user_id: ownerUserId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
			})
			.returning()
		if (!task) throw new Error('Failed to create test task')
		return task
	}

	it.effect('cascades ownership atomically and preserves provenance and workspace state', () =>
		Effect.gen(function* () {
			const task = yield* Effect.promise(() => createTask('cascade and invariants'))
			const hostId = crypto.randomUUID()
			const [session] = yield* Effect.promise(() =>
				db
					.insert(sessions)
					.values({
						task_id: task.id,
						organization_id: organizationId,
						resource_owner_user_id: ownerUserId,
						created_by: editorUserId,
						host_id: hostId,
						working_directory: '/workspace/original',
						status: 'running',
					})
					.returning(),
			)
			if (!session) return yield* Effect.die('Failed to create test session')

			yield* Effect.promise(() =>
				db.insert(conversationEvents).values({
					session_id: session.id,
					task_id: task.id,
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					event_type: 'message',
					role: 'user',
					content: 'historical content',
					user_id: editorUserId,
				}),
			)
			yield* Effect.promise(() =>
				db.insert(approvals).values({
					session_id: session.id,
					task_id: task.id,
					organization_id: organizationId,
					resource_owner_user_id: ownerUserId,
					user_id: editorUserId,
					host_id: hostId,
					approved_by_user_id: adminUserId,
					status: 'approved',
				}),
			)
			yield* Effect.promise(() =>
				db.insert(taskUserSettings).values({
					task_id: task.id,
					organization_id: organizationId,
					user_id: editorUserId,
					working_directory: '/workspace/user-setting',
					host_id: hostId,
				}),
			)
			yield* Effect.promise(() =>
				db.insert(taskWorkspaceSetupForHost).values({
					task_id: task.id,
					organization_id: organizationId,
					host_id: hostId,
					status: 'done',
					workspace_setup_state: { specVersion: 1, repos: [] },
				}),
			)

			const result = yield* runReassignment({ taskId: task.id })
			expect(result).toMatchObject({
				taskId: task.id,
				previousOwnerUserId: ownerUserId,
				newOwnerUserId,
			})
			expect(result.transactionId).not.toBe('')

			const [storedTask] = yield* Effect.promise(() => db.select().from(tasks).where(eq(tasks.id, task.id)))
			const [storedSession] = yield* Effect.promise(() =>
				db.select().from(sessions).where(eq(sessions.id, session.id)),
			)
			const [storedEvent] = yield* Effect.promise(() =>
				db.select().from(conversationEvents).where(eq(conversationEvents.session_id, session.id)),
			)
			const [storedApproval] = yield* Effect.promise(() =>
				db.select().from(approvals).where(eq(approvals.session_id, session.id)),
			)
			const [storedSetting] = yield* Effect.promise(() =>
				db.select().from(taskUserSettings).where(eq(taskUserSettings.task_id, task.id)),
			)
			const [storedWorkspace] = yield* Effect.promise(() =>
				db.select().from(taskWorkspaceSetupForHost).where(eq(taskWorkspaceSetupForHost.task_id, task.id)),
			)

			expect(storedTask?.resource_owner_user_id).toBe(newOwnerUserId)
			expect(storedTask?.created_by).toBe(ownerUserId)
			expect(storedSession).toMatchObject({
				resource_owner_user_id: newOwnerUserId,
				created_by: editorUserId,
				host_id: hostId,
				status: 'running',
			})
			expect(storedEvent).toMatchObject({ resource_owner_user_id: newOwnerUserId, user_id: editorUserId })
			expect(storedApproval).toMatchObject({
				resource_owner_user_id: newOwnerUserId,
				user_id: editorUserId,
				approved_by_user_id: adminUserId,
			})
			expect(storedSetting).toMatchObject({ working_directory: '/workspace/user-setting', host_id: hostId })
			expect(storedWorkspace).toMatchObject({ host_id: hostId, status: 'done' })

			const [previousOwnerAcl] = yield* Effect.promise(() =>
				db
					.select()
					.from(taskUserAcl)
					.where(and(eq(taskUserAcl.task_id, task.id), eq(taskUserAcl.subject_user_id, ownerUserId))),
			)
			expect(previousOwnerAcl).toMatchObject({
				permission_level: 'edit',
				resource_owner_user_id: newOwnerUserId,
			})
			const auditRows = yield* Effect.promise(() =>
				db
					.select()
					.from(aclOperationsLog)
					.where(
						and(eq(aclOperationsLog.task_id, task.id), eq(aclOperationsLog.target_user_id, ownerUserId)),
					),
			)
			expect(auditRows).toHaveLength(1)
			expect(auditRows[0]).toMatchObject({ operation: 'create', permission_level_after: 'edit' })
		}),
	)

	it.effect('allows organization admins and rejects editors', () =>
		Effect.gen(function* () {
			const adminTask = yield* Effect.promise(() => createTask('admin reassignment'))
			const adminResult = yield* runReassignment({
				taskId: adminTask.id,
				actingUserId: adminUserId,
				isAdmin: true,
			})
			expect(adminResult.newOwnerUserId).toBe(newOwnerUserId)

			const editorTask = yield* Effect.promise(() => createTask('editor rejection'))
			yield* Effect.promise(() =>
				db.insert(taskUserAcl).values({
					task_id: editorTask.id,
					organization_id: organizationId,
					subject_user_id: editorUserId,
					resource_owner_user_id: ownerUserId,
					permission_level: 'edit',
					granted_by: ownerUserId,
				}),
			)
			const error = yield* runReassignment({ taskId: editorTask.id, actingUserId: editorUserId }).pipe(
				Effect.flip,
			)
			expect(error).toBeInstanceOf(TaskOwnerReassignmentForbiddenError)
		}),
	)

	it.effect('rejects inactive, unchanged, and missing recipients without changing state', () =>
		Effect.gen(function* () {
			const inactiveTask = yield* Effect.promise(() => createTask('inactive recipient'))
			const inactiveError = yield* runReassignment({
				taskId: inactiveTask.id,
				newOwnerId: 'user_inactive',
			}).pipe(Effect.flip)
			expect(inactiveError).toBeInstanceOf(TaskOwnerRecipientIneligibleError)

			const unchangedTask = yield* Effect.promise(() => createTask('unchanged recipient'))
			const unchangedMembershipLayer = Layer.succeed(WorkosService, {
				...activeWorkosService,
				...activeWorkosService,
				listActiveOrganizationMemberships: () =>
					Effect.succeed([{ userId: ownerUserId, organizationId: workosOrganizationId }]),
			})
			const unchangedError = yield* reassignTaskOwner({
				taskId: unchangedTask.id,
				newOwnerUserId: ownerUserId,
				actingUserId: ownerUserId,
				organizationId,
				workosOrganizationId,
				actingUserIsOrganizationAdmin: false,
			}).pipe(Effect.provide(Layer.merge(PostgresDbLive(db), unchangedMembershipLayer)), Effect.flip)
			expect(unchangedError).toBeInstanceOf(TaskOwnerRecipientUnchangedError)

			const missingError = yield* runReassignment({ taskId: crypto.randomUUID() }).pipe(Effect.flip)
			expect(missingError).toBeInstanceOf(TaskOwnerTaskNotFoundError)
		}),
	)

	it.effect('rolls back every owner update when a late ACL write fails', () =>
		Effect.gen(function* () {
			const task = yield* Effect.promise(() => createTask('rollback on late failure'))
			const [session] = yield* Effect.promise(() =>
				db
					.insert(sessions)
					.values({
						task_id: task.id,
						organization_id: organizationId,
						resource_owner_user_id: ownerUserId,
						created_by: ownerUserId,
						host_id: crypto.randomUUID(),
						working_directory: tmpdir(),
						status: 'running',
					})
					.returning(),
			)
			if (!session) return yield* Effect.die('Failed to create rollback session')

			yield* Effect.promise(() =>
				db.execute(sql`CREATE TABLE reassignment_failure_tasks_for_test (task_id uuid PRIMARY KEY)`),
			)
			yield* Effect.promise(() =>
				db.execute(sql`INSERT INTO reassignment_failure_tasks_for_test (task_id) VALUES (${task.id})`),
			)
			yield* Effect.promise(() =>
				db.execute(sql`
					CREATE FUNCTION reject_previous_owner_acl_for_test() RETURNS trigger AS $$
					BEGIN
						IF EXISTS (
							SELECT 1 FROM reassignment_failure_tasks_for_test WHERE task_id = NEW.task_id
						) THEN
							RAISE EXCEPTION 'injected late reassignment failure';
						END IF;
						RETURN NEW;
					END;
					$$ LANGUAGE plpgsql;
				`),
			)
			yield* Effect.promise(() =>
				db.execute(sql`
					CREATE TRIGGER reject_previous_owner_acl_for_test
					BEFORE INSERT OR UPDATE ON task_user_acl
					FOR EACH ROW EXECUTE FUNCTION reject_previous_owner_acl_for_test();
				`),
			)
			const error = yield* runReassignment({ taskId: task.id }).pipe(Effect.flip)
			expect(error).toBeInstanceOf(TaskOwnerDatabaseFailureError)

			yield* Effect.promise(() =>
				db.execute(sql`DROP TRIGGER reject_previous_owner_acl_for_test ON task_user_acl`),
			)
			yield* Effect.promise(() => db.execute(sql`DROP FUNCTION reject_previous_owner_acl_for_test()`))
			yield* Effect.promise(() => db.execute(sql`DROP TABLE reassignment_failure_tasks_for_test`))

			const [storedTask] = yield* Effect.promise(() => db.select().from(tasks).where(eq(tasks.id, task.id)))
			const [storedSession] = yield* Effect.promise(() =>
				db.select().from(sessions).where(eq(sessions.id, session.id)),
			)
			expect(storedTask?.resource_owner_user_id).toBe(ownerUserId)
			expect(storedSession?.resource_owner_user_id).toBe(ownerUserId)
			const previousOwnerAcls = yield* Effect.promise(() =>
				db
					.select()
					.from(taskUserAcl)
					.where(and(eq(taskUserAcl.task_id, task.id), eq(taskUserAcl.subject_user_id, ownerUserId))),
			)
			expect(previousOwnerAcls).toHaveLength(0)
		}),
	)
})
