import { describe, expect, test } from 'vitest'

import {
	ClaudeSdkError,
	classifyClaudeSessionErrorReason,
	describeClaudeSdkCause,
} from '../../src/effects/services/claude-sessions/sdk/claude-sdk-error'

describe('describeClaudeSdkCause', () => {
	test('uses the error message', () => {
		expect(describeClaudeSdkCause(new Error('Claude Code process exited with code 1. stderr: boom'))).toBe(
			'Claude Code process exited with code 1. stderr: boom',
		)
	})

	test('follows the cause chain', () => {
		const cause = new Error('spawn claude ENOENT')
		expect(describeClaudeSdkCause(new Error('failed to start', { cause }))).toBe(
			'failed to start: spawn claude ENOENT',
		)
	})

	test('skips a nested cause already contained in the outer message', () => {
		const cause = new Error('exited with code 1')
		expect(describeClaudeSdkCause(new Error('Claude Code process exited with code 1', { cause }))).toBe(
			'Claude Code process exited with code 1',
		)
	})

	test('falls back to the error name when the message is empty', () => {
		expect(describeClaudeSdkCause(new TypeError(''))).toBe('TypeError')
	})

	test('describes non-error causes', () => {
		expect(describeClaudeSdkCause('process died')).toBe('process died')
		expect(describeClaudeSdkCause({ message: 'invalid api key' })).toBe('invalid api key')
		expect(describeClaudeSdkCause({ code: 401 })).toBe('code: 401')
		expect(describeClaudeSdkCause(undefined)).toBe('Unknown error')
		expect(describeClaudeSdkCause(null)).toBe('Unknown error')
	})

	test('renders known SDK diagnostics and their nested cause', () => {
		expect(
			describeClaudeSdkCause({
				name: 'ClaudeProcessError',
				exitCode: 1,
				stderr: 'not authenticated',
				stdout: 'retrying',
				status: 401,
				cause: new Error('token rejected'),
			}),
		).toBe(
			'ClaudeProcessError; stderr: not authenticated; stdout: retrying; exit code: 1; status: 401: token rejected',
		)
	})

	test('does not expose unrecognized objects', () => {
		expect(describeClaudeSdkCause({ secret: 'do not show' })).toBe('Unknown error')
	})
})

describe('ClaudeSdkError', () => {
	test('reports the operation and underlying cause', () => {
		const error = new ClaudeSdkError({
			operation: 'output',
			cause: new Error('Claude Code process exited with code 1. stderr: not authenticated'),
		})

		expect(error.message).toBe(
			'Claude SDK output failed: Claude Code process exited with code 1. stderr: not authenticated',
		)
		expect(String(error)).toContain('not authenticated')
	})

	test('stays readable when the cause carries no detail', () => {
		const error = new ClaudeSdkError({ operation: 'open', cause: undefined })

		expect(error.message).toBe('Claude SDK open failed: Unknown error')
	})
})

describe('classifyClaudeSessionErrorReason', () => {
	test.each(['Not logged in · Please run /login', 'Invalid API key · Please run /login', 'OAuth token has expired'])(
		'classifies %s as auth_required',
		(message) => {
			expect(classifyClaudeSessionErrorReason(message)).toBe('auth_required')
		},
	)

	test.each(['MCP server github failed authentication', 'Failed to fetch https://example.com/login/callback'])(
		'leaves %s unclassified',
		(message) => {
			expect(classifyClaudeSessionErrorReason(message)).toBeNull()
		},
	)
})
