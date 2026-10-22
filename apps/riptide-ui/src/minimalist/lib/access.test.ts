import { describe, expect, it } from 'vitest'

import { isMultiplayerThread, memberFirstName, memberName } from '@/minimalist/lib/access'

describe('memberName', () => {
	it('prefers the full name, then the email', () => {
		expect(memberName({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' })).toBe('Ada Lovelace')
		expect(memberName({ email: 'ada@example.com' })).toBe('ada@example.com')
		expect(memberName(undefined)).toBe('Someone')
	})

	it('shortens to a first name or the email before the @', () => {
		expect(memberFirstName({ firstName: 'Ada', email: 'ada@example.com' })).toBe('Ada')
		expect(memberFirstName({ email: 'dex+22@example.com' })).toBe('dex+22')
		expect(memberFirstName(undefined)).toBe('Someone')
	})
})

describe('isMultiplayerThread', () => {
	const solo = { multiplayer_prompting_started_at: null }

	it('is multiplayer once the owner has shared prompting, even with one author', () => {
		expect(isMultiplayerThread({ multiplayer_prompting_started_at: 1n }, ['user_ada'])).toBe(true)
	})

	it('is multiplayer when more than one person wrote in it', () => {
		expect(isMultiplayerThread(solo, ['user_ada', null, 'user_ada'])).toBe(false)
		expect(isMultiplayerThread(solo, ['user_ada', 'user_grace'])).toBe(true)
	})
})
