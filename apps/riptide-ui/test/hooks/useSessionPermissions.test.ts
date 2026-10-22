import { describe, expect, test } from 'vitest'

import { computeSessionPermissions, type SessionLike } from '../../src/hooks/useSessionPermissions'

const TASK_OWNER_ID = 'user-task-owner'
const SESSION_CREATOR_ID = 'user-session-creator'
const ORG_MEMBER_READ_ID = 'user-org-read'
const ORG_MEMBER_EDIT_ID = 'user-org-edit'
const NOW = 1_000_000

function standaloneSession(createdBy: string): SessionLike {
	return {
		resource_owner_user_id: createdBy,
		created_by: createdBy,
		task_id: null,
	}
}

function taskSession(createdBy: string, taskOwnerId = TASK_OWNER_ID): SessionLike {
	return {
		resource_owner_user_id: taskOwnerId,
		created_by: createdBy,
		task_id: 'task-1',
	}
}

function grantedSession(createdBy: string, userId: string, taskId: string | null = 'task-1'): SessionLike {
	return {
		resource_owner_user_id: createdBy,
		created_by: createdBy,
		task_id: taskId,
		multiplayer_prompting_user_ids: [userId],
		multiplayer_prompting_started_at: BigInt(NOW - 1),
		multiplayer_prompting_expires_at: BigInt(NOW + 1),
	}
}

describe('computeSessionPermissions', () => {
	describe('standalone sessions (no task)', () => {
		test('session creator has full access', () => {
			const result = computeSessionPermissions(
				standaloneSession(SESSION_CREATOR_ID),
				SESSION_CREATOR_ID,
				null,
				false,
			)
			expect(result.canManageSession).toBe(true)
			expect(result.isOwner).toBe(true)
		})

		test('other user has no access', () => {
			const result = computeSessionPermissions(
				standaloneSession(SESSION_CREATOR_ID),
				ORG_MEMBER_READ_ID,
				null,
				false,
			)
			expect(result.canManageSession).toBe(false)
			expect(result.isOwner).toBe(false)
		})
	})

	describe('task-associated sessions', () => {
		test('task owner who created session with edit ACL has full access', () => {
			const result = computeSessionPermissions(
				taskSession(TASK_OWNER_ID, TASK_OWNER_ID),
				TASK_OWNER_ID,
				'edit',
				false,
			)
			expect(result.canManageSession).toBe(true)
			expect(result.isOwner).toBe(true)
		})

		test('session creator with edit ACL on task can manage', () => {
			const result = computeSessionPermissions(taskSession(SESSION_CREATOR_ID), SESSION_CREATOR_ID, 'edit', false)
			expect(result.canManageSession).toBe(true)
			expect(result.isOwner).toBe(true)
		})

		test('session creator with only read ACL on task cannot manage', () => {
			const result = computeSessionPermissions(taskSession(SESSION_CREATOR_ID), SESSION_CREATOR_ID, 'read', false)
			expect(result.isOwner).toBe(true)
			expect(result.canManageSession).toBe(false)
		})

		test('org member with edit ACL who did not create session cannot manage', () => {
			const result = computeSessionPermissions(taskSession(SESSION_CREATOR_ID), ORG_MEMBER_EDIT_ID, 'edit', false)
			expect(result.isOwner).toBe(false)
			expect(result.canManageSession).toBe(false)
		})

		test('org member with read ACL cannot manage', () => {
			const result = computeSessionPermissions(taskSession(SESSION_CREATOR_ID), ORG_MEMBER_READ_ID, 'read', false)
			expect(result.isOwner).toBe(false)
			expect(result.canManageSession).toBe(false)
		})
	})

	describe('fork permission gating (canManageSession)', () => {
		test('read-only user on a shared task cannot fork', () => {
			const result = computeSessionPermissions(taskSession(SESSION_CREATOR_ID), ORG_MEMBER_READ_ID, 'read', false)
			expect(result.canManageSession).toBe(false)
		})

		test('edit user on a shared task who did not create the session cannot fork', () => {
			const result = computeSessionPermissions(taskSession(SESSION_CREATOR_ID), ORG_MEMBER_EDIT_ID, 'edit', false)
			expect(result.canManageSession).toBe(false)
		})

		test('session creator with edit access on task can fork', () => {
			const result = computeSessionPermissions(taskSession(SESSION_CREATOR_ID), SESSION_CREATOR_ID, 'edit', false)
			expect(result.canManageSession).toBe(true)
		})

		test('owner of standalone session can fork', () => {
			const result = computeSessionPermissions(
				standaloneSession(SESSION_CREATOR_ID),
				SESSION_CREATOR_ID,
				null,
				false,
			)
			expect(result.canManageSession).toBe(true)
		})
	})

	describe('multiplayer prompt grants', () => {
		test('active task collaborator with edit permission can prompt but not manage', () => {
			const result = computeSessionPermissions(
				grantedSession(SESSION_CREATOR_ID, ORG_MEMBER_EDIT_ID),
				ORG_MEMBER_EDIT_ID,
				'edit',
				true,
				NOW,
			)
			expect(result.accessLevel).toBe('prompt')
			expect(result.canSendPrompt).toBe(true)
			expect(result.canManageSession).toBe(false)
		})

		test('exact expiry returns collaborator to view', () => {
			const result = computeSessionPermissions(
				grantedSession(SESSION_CREATOR_ID, ORG_MEMBER_EDIT_ID),
				ORG_MEMBER_EDIT_ID,
				'edit',
				true,
				NOW + 1,
			)
			expect(result.accessLevel).toBe('view')
			expect(result.canSendPrompt).toBe(false)
		})

		test('feature disablement returns collaborator to view', () => {
			const result = computeSessionPermissions(
				grantedSession(SESSION_CREATOR_ID, ORG_MEMBER_EDIT_ID),
				ORG_MEMBER_EDIT_ID,
				'edit',
				false,
				NOW,
			)
			expect(result.accessLevel).toBe('view')
		})

		test('standalone active collaborator can prompt without task permission', () => {
			const result = computeSessionPermissions(
				grantedSession(SESSION_CREATOR_ID, ORG_MEMBER_EDIT_ID, null),
				ORG_MEMBER_EDIT_ID,
				null,
				true,
				NOW,
			)
			expect(result.accessLevel).toBe('prompt')
		})
	})

	describe('edge cases', () => {
		test('undefined session returns no access', () => {
			const result = computeSessionPermissions(undefined, SESSION_CREATOR_ID, null, false)
			expect(result.canManageSession).toBe(false)
			expect(result.isOwner).toBe(false)
		})

		test('undefined userId returns no access', () => {
			const result = computeSessionPermissions(standaloneSession(SESSION_CREATOR_ID), undefined, null, false)
			expect(result.canManageSession).toBe(false)
			expect(result.isOwner).toBe(false)
		})
	})
})
