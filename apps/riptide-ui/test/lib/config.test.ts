import { describe, expect, it } from 'vitest'

import { buildDisplayLabel } from '@/lib/config'

describe('buildDisplayLabel', () => {
	it('shows the stack name for stack-local native builds', () => {
		expect(buildDisplayLabel({ channelName: 'Local', devstackId: 'feature-native' })).toBe('devstk-feature-native')
	})

	it('keeps the release channel without a stack identity', () => {
		expect(buildDisplayLabel({ channelName: 'Beta', devstackId: null })).toBe('Beta')
	})
})
