import { describe, expect, test } from 'vitest'

import {
	calculateSessionAccessControlLevel,
	hasRequiredSessionAccess,
	isMultiplayerPromptingActive,
	SessionAccessControl,
} from './session-multiplayer-prompting-auth'

const base = {
	actorUserId: 'collaborator',
	sessionCreatedBy: 'owner',
	sessionResourceOwnerUserId: 'owner',
	sessionTaskId: 'task-id',
	multiplayerPromptingEnabledForOrganization: true,
	multiplayerPromptingUserIds: ['collaborator'],
	multiplayerPromptingStartedAt: 1_000n,
	multiplayerPromptingExpiresAt: 2_000n,
	effectiveTaskPermission: 'edit' as const,
	nowMillis: 1_500,
}

describe('calculateSessionAccessControlLevel', () => {
	test('owner requires creator identity and task edit', () => {
		expect(
			calculateSessionAccessControlLevel({ ...base, actorUserId: 'owner', effectiveTaskPermission: 'edit' }),
		).toBe(SessionAccessControl.owner)
	})

	test('active task collaborator receives prompt access', () => {
		expect(calculateSessionAccessControlLevel(base)).toBe(SessionAccessControl.prompt)
	})

	test('exact start is active and exact expiry is inactive', () => {
		expect(calculateSessionAccessControlLevel({ ...base, nowMillis: 1_000 })).toBe(SessionAccessControl.prompt)
		expect(calculateSessionAccessControlLevel({ ...base, nowMillis: 2_000 })).toBe(SessionAccessControl.view)
	})

	test('unlimited grant remains active', () => {
		expect(
			calculateSessionAccessControlLevel({ ...base, multiplayerPromptingExpiresAt: null, nowMillis: 9_999 }),
		).toBe(SessionAccessControl.prompt)
	})

	test('feature disabled, missing roster, or insufficient task permission returns view', () => {
		expect(calculateSessionAccessControlLevel({ ...base, multiplayerPromptingEnabledForOrganization: false })).toBe(
			SessionAccessControl.view,
		)
		expect(calculateSessionAccessControlLevel({ ...base, multiplayerPromptingUserIds: [] })).toBe(
			SessionAccessControl.view,
		)
		expect(calculateSessionAccessControlLevel({ ...base, effectiveTaskPermission: 'read' })).toBe(
			SessionAccessControl.view,
		)
	})

	test('standalone collaborator can prompt only while actively granted', () => {
		expect(
			calculateSessionAccessControlLevel({ ...base, sessionTaskId: null, effectiveTaskPermission: null }),
		).toBe(SessionAccessControl.prompt)
		expect(
			calculateSessionAccessControlLevel({
				...base,
				sessionTaskId: null,
				effectiveTaskPermission: null,
				nowMillis: 2_000,
			}),
		).toBe(SessionAccessControl.noAccess)
	})
})

describe('isMultiplayerPromptingActive', () => {
	test('is true for a live grant regardless of the actor', () => {
		expect(isMultiplayerPromptingActive(base)).toBe(true)
		expect(isMultiplayerPromptingActive({ ...base, multiplayerPromptingExpiresAt: null, nowMillis: 9_999 })).toBe(
			true,
		)
	})

	test('is false when the feature is off, the roster is empty, or the window is closed', () => {
		expect(isMultiplayerPromptingActive({ ...base, multiplayerPromptingEnabledForOrganization: false })).toBe(false)
		expect(isMultiplayerPromptingActive({ ...base, multiplayerPromptingUserIds: [] })).toBe(false)
		expect(isMultiplayerPromptingActive({ ...base, multiplayerPromptingStartedAt: null })).toBe(false)
		expect(isMultiplayerPromptingActive({ ...base, nowMillis: 999 })).toBe(false)
		expect(isMultiplayerPromptingActive({ ...base, nowMillis: 2_000 })).toBe(false)
	})
})

describe('hasRequiredSessionAccess', () => {
	test('accepts the required level and higher levels', () => {
		expect(hasRequiredSessionAccess(SessionAccessControl.prompt, SessionAccessControl.prompt)).toBe(true)
		expect(hasRequiredSessionAccess(SessionAccessControl.owner, SessionAccessControl.prompt)).toBe(true)
	})

	test('rejects levels below the required level', () => {
		expect(hasRequiredSessionAccess(SessionAccessControl.view, SessionAccessControl.prompt)).toBe(false)
		expect(hasRequiredSessionAccess(SessionAccessControl.noAccess, SessionAccessControl.view)).toBe(false)
	})
})
