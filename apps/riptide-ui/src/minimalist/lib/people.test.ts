import { describe, expect, it } from 'vitest'

import { personName, taskPeople } from '@/minimalist/lib/people'

describe('personName', () => {
	it('names a member by full name, then email, then their id', () => {
		expect(personName('user_123456789', { firstName: 'Ada', lastName: 'Lovelace', email: 'a@x.dev' })).toBe(
			'Ada Lovelace',
		)
		expect(personName('user_123456789', { email: 'a@x.dev' })).toBe('a@x.dev')
		expect(personName('user_123456789', undefined)).toBe('user_123')
	})
})

describe('taskPeople', () => {
	it('lists each session starter and commenter once, leaving out the owner and anonymous authors', () => {
		expect(taskPeople('owner', ['owner', 'ana', null, 'ben', 'ana', undefined, 'owner', 'cy'])).toEqual([
			'ana',
			'ben',
			'cy',
		])
	})
})
