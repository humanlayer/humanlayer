import { describe, expect, test } from 'vitest'

import { normalizeOrganizationDomain } from './organization-domain'

describe('normalizeOrganizationDomain', () => {
	test.each([
		['example.com', 'example.com'],
		['  example.com  ', 'example.com'],
		['https://example.com', 'example.com'],
		['HTTP://EXAMPLE.COM', 'example.com'],
		['https://example.com/path?query=value#section', 'example.com'],
		['https://example.com:8443/path', 'example.com'],
	])('normalizes %s to %s', (input, expected) => {
		expect(normalizeOrganizationDomain(input)).toBe(expected)
	})
})
