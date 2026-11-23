import { describe, expect, test } from 'vitest'

import {
	capabilitiesStateFromQuery,
	type IntegrationCapabilities,
	isIntegrationAvailable,
	isIntegrationNotSetUp,
} from './integration-capabilities'

const capabilities: IntegrationCapabilities = {
	slack: false,
	github: true,
	jira: true,
	linear: false,
	billing: false,
	email: { configured: false },
}

describe('capabilitiesStateFromQuery', () => {
	test('is checking until the request answers', () => {
		expect(capabilitiesStateFromQuery({ data: undefined, isError: false })).toEqual({ status: 'checking' })
	})

	test('is known once the server answers', () => {
		expect(capabilitiesStateFromQuery({ data: capabilities, isError: false })).toEqual({
			status: 'known',
			capabilities,
		})
	})

	test('is unknown when the request fails', () => {
		expect(capabilitiesStateFromQuery({ data: undefined, isError: true })).toEqual({ status: 'unknown' })
	})
})

describe('integration availability', () => {
	const known = capabilitiesStateFromQuery({ data: capabilities, isError: false })

	test('does not start status polling while checking', () => {
		expect(isIntegrationAvailable({ status: 'checking' }, 'github')).toBe(false)
		expect(isIntegrationNotSetUp({ status: 'checking' }, 'slack')).toBe(false)
	})

	test('follows the server answer once known', () => {
		expect(isIntegrationAvailable(known, 'github')).toBe(true)
		expect(isIntegrationAvailable(known, 'slack')).toBe(false)
		expect(isIntegrationNotSetUp(known, 'linear')).toBe(true)
		expect(isIntegrationNotSetUp(known, 'jira')).toBe(false)
	})

	test('treats every integration as set up when capabilities could not load', () => {
		expect(isIntegrationAvailable({ status: 'unknown' }, 'slack')).toBe(true)
		expect(isIntegrationNotSetUp({ status: 'unknown' }, 'slack')).toBe(false)
	})
})
