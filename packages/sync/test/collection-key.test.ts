import { describe, expect, test } from 'vitest'

import { defaultCollectionKey } from '../src/collection-key.ts'

describe('defaultCollectionKey', () => {
	test('returns an id key from a standard collection row', () => {
		expect(defaultCollectionKey({ id: 'row-1' })).toBe('row-1')
	})

	test('rejects rows without a string id', () => {
		expect(() => defaultCollectionKey({ key: 'row-1' })).toThrow(
			'Collection rows without a string id must provide getKey',
		)
	})
})
