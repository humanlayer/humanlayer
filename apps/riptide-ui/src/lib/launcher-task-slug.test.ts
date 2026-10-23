import { describe, expect, test } from 'vitest'

import { generateLauncherSlugSuffix, generateLauncherTaskSlug } from './launcher-task-slug'

describe('launcher task slugs', () => {
	test('samples all lowercase letters and digits, rejecting bytes outside the unbiased range', () => {
		let calls = 0
		const suffix = generateLauncherSlugSuffix((bytes) => {
			bytes.set(calls++ === 0 ? [252, 253, 254, 255, 0, 25] : [26, 35, 36, 251, 0, 0])
		})
		expect(suffix).toBe('az09a9')
		expect(calls).toBe(2)
		expect(suffix).toMatch(/^[a-z0-9]{6}$/)
	})

	test('normalizes the readable prefix and includes the suffix within the length limit', () => {
		expect(generateLauncherTaskSlug('  A Better! TITLE  ', () => 'k4m8q2')).toBe('a-better-title-k4m8q2')
		expect(generateLauncherTaskSlug('a'.repeat(120), () => 'k4m8q2')).toHaveLength(100)
		expect(generateLauncherTaskSlug(`${'a'.repeat(92)} more`, () => 'k4m8q2')).not.toContain('--')
		expect(generateLauncherTaskSlug('!!!', () => 'k4m8q2')).toBe('')
	})

	test('requests fresh randomness each time, including repeated titles', () => {
		let count = 0
		const suffix = () =>
			generateLauncherSlugSuffix((bytes) => {
				bytes.fill(count++)
			})
		expect(generateLauncherTaskSlug('Same title', suffix)).toBe('same-title-aaaaaa')
		expect(generateLauncherTaskSlug('Same title', suffix)).toBe('same-title-bbbbbb')
	})
})
