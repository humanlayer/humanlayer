import { describe, expect, test } from 'vitest'

import { isUuid } from '../src/lib/validation'

describe('validation', () => {
	describe('isUuid', () => {
		test('accepts valid UUID v4', () => {
			expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
		})

		test('accepts valid UUID v1', () => {
			expect(isUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true)
		})

		test('accepts valid UUID v7 (used by this codebase)', () => {
			expect(isUuid('019d8ee6-a03a-7fb2-a79c-130f5ee12bb6')).toBe(true)
		})

		test('accepts lowercase UUIDs', () => {
			expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
		})

		test('accepts uppercase UUIDs', () => {
			expect(isUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
		})

		test('accepts mixed case UUIDs', () => {
			expect(isUuid('550E8400-e29b-41D4-a716-446655440000')).toBe(true)
		})

		test('rejects SQL injection payloads', () => {
			expect(isUuid("' OR 1=1) --")).toBe(false)
			expect(isUuid("'; DROP TABLE users; --")).toBe(false)
			expect(isUuid("1' OR '1'='1")).toBe(false)
		})

		test('rejects empty string', () => {
			expect(isUuid('')).toBe(false)
		})

		test('rejects non-UUID strings', () => {
			expect(isUuid('not-a-uuid')).toBe(false)
			expect(isUuid('12345')).toBe(false)
			expect(isUuid('hello-world')).toBe(false)
		})

		test('rejects UUID with wrong format', () => {
			// Missing hyphens
			expect(isUuid('550e8400e29b41d4a716446655440000')).toBe(false)
			// Wrong number of characters
			expect(isUuid('550e8400-e29b-41d4-a716-44665544000')).toBe(false)
			// Invalid characters
			expect(isUuid('550e8400-e29b-41d4-a716-44665544000g')).toBe(false)
		})
	})
})
