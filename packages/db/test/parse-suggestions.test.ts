import { describe, expect, test } from 'vitest'

import { parseSuggestions } from '../src/zodschemas/permission-update'

describe('parseSuggestions', () => {
	test('undefined returns undefined', () => {
		expect(parseSuggestions(undefined)).toBeUndefined()
	})

	test('null returns undefined', () => {
		expect(parseSuggestions(null)).toBeUndefined()
	})

	test('plain array of valid PermissionUpdate returns parsed suggestions', () => {
		const input = [
			{
				type: 'addRules',
				rules: [{ toolName: 'Bash', ruleContent: 'git push *' }],
				behavior: 'allow',
				destination: 'localSettings',
			},
		]

		expect(parseSuggestions(input)).toEqual(input)
	})

	test('stringified JSON array parses legacy suggestions', () => {
		const input = JSON.stringify([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])

		const parsed = parseSuggestions(input)

		expect(parsed).toHaveLength(1)
		expect(parsed?.[0]?.type).toBe('setMode')
	})

	test('malformed JSON string returns undefined', () => {
		expect(parseSuggestions('{ not json')).toBeUndefined()
	})

	test('non-array input returns undefined', () => {
		expect(parseSuggestions(JSON.stringify({ type: 'addRules' }))).toBeUndefined()
		expect(parseSuggestions({ type: 'addRules' })).toBeUndefined()
	})

	test('mixed valid and invalid entries keeps only valid entries', () => {
		const input = [
			{ type: 'setMode', mode: 'acceptEdits', destination: 'session' },
			{ type: 'bogus' },
			{ type: 'addDirectories', directories: ['/tmp'], destination: 'session' },
		]

		const parsed = parseSuggestions(input)

		expect(parsed).toHaveLength(2)
		expect(parsed?.map((suggestion) => suggestion.type)).toEqual(['setMode', 'addDirectories'])
	})

	test('all-invalid entries returns undefined', () => {
		expect(parseSuggestions([{ type: 'bogus' }, { foo: 'bar' }])).toBeUndefined()
	})
})
