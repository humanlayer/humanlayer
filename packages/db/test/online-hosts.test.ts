import { describe, expect, test } from 'vitest'

import { onlineHostInsertSchema, onlineHostSelectSchema, onlineHostUpdateSchema } from '../src/tables/online-hosts'

describe('online host ephemeral schemas', () => {
	test.each([true, false])('exposes ephemeral=%s on table-derived schemas', (ephemeral) => {
		for (const schema of [onlineHostInsertSchema, onlineHostSelectSchema, onlineHostUpdateSchema]) {
			expect(schema.pick({ ephemeral: true }).parse({ ephemeral })).toEqual({ ephemeral })
		}
	})

	test('permits omission on writes but requires a non-null boolean on reads', () => {
		expect(onlineHostInsertSchema.pick({ ephemeral: true }).parse({})).toEqual({})
		expect(onlineHostUpdateSchema.pick({ ephemeral: true }).parse({})).toEqual({})
		expect(onlineHostSelectSchema.pick({ ephemeral: true }).safeParse({}).success).toBe(false)
		expect(onlineHostSelectSchema.pick({ ephemeral: true }).safeParse({ ephemeral: null }).success).toBe(false)
	})
})
