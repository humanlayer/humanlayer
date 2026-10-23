import { describe, expect, test } from 'vitest'

import {
	computeEffectiveConfigFromParsed,
	parseWorkspaceConfig,
	parseWorkspaceConfigResult,
	parseWorkspaceLocalConfigResult,
} from './workspace-config'

describe('workspace config parsing', () => {
	test('compat parser returns null for missing content', () => {
		expect(parseWorkspaceConfig(null)).toBeNull()
		expect(parseWorkspaceConfig('')).toBeNull()
	})

	test('parseWorkspaceConfigResult identifies missing files', () => {
		expect(parseWorkspaceConfigResult(null)).toEqual({
			ok: false,
			error: { type: 'missing', message: 'File does not exist' },
		})
	})

	test('parseWorkspaceConfigResult identifies invalid JSON', () => {
		const result = parseWorkspaceConfigResult('{ nope')

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe('invalid_json')
			expect(result.error.message).toContain('JSON')
		}
	})

	test('parseWorkspaceConfigResult includes schema validation path', () => {
		const result = parseWorkspaceConfigResult(JSON.stringify({ repos: [{ localPath: '' }] }))

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe('schema_error')
			expect(result.error.message).toContain('repos.0.localPath')
			expect(result.error.message).toContain('localPath is required')
		}
	})

	test('parseWorkspaceConfigResult rejects unknown root fields', () => {
		const result = parseWorkspaceConfigResult(JSON.stringify({ coopyGlobes: ['hi'] }))

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe('schema_error')
			expect(result.error.message).toContain('coopyGlobes')
		}
	})

	test('parseWorkspaceConfigResult rejects unknown repo fields', () => {
		const result = parseWorkspaceConfigResult(JSON.stringify({ repos: [{ localPath: '.', coopyGlobes: ['hi'] }] }))

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe('schema_error')
			expect(result.error.message).toContain('repos.0')
			expect(result.error.message).toContain('coopyGlobes')
		}
	})

	test('parseWorkspaceLocalConfigResult rejects unknown root fields', () => {
		const result = parseWorkspaceLocalConfigResult(JSON.stringify({ fack: 'No' }))

		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error.type).toBe('schema_error')
			expect(result.error.message).toContain('fack')
		}
	})

	test('parseWorkspaceLocalConfigResult accepts local delete patches', () => {
		const result = parseWorkspaceLocalConfigResult(
			JSON.stringify({ repos: [{ localPath: '../api', $patch: 'delete' }] }),
		)

		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.data.repos?.[0]).toEqual({ localPath: '../api', $patch: 'delete' })
		}
	})

	test('parsed repo and local configs merge into an effective config', () => {
		const repoResult = parseWorkspaceConfigResult(
			JSON.stringify({
				sourceRef: 'origin/main',
				branchRemote: 'origin',
				repos: [{ localPath: '.', description: 'App' }],
			}),
		)
		const localResult = parseWorkspaceLocalConfigResult(
			JSON.stringify({
				setupCommand: 'bun install',
				repos: [{ localPath: '../api', description: 'API', branchRemote: 'fork' }],
			}),
		)

		expect(repoResult.ok).toBe(true)
		expect(localResult.ok).toBe(true)
		if (!repoResult.ok || !localResult.ok) return

		const config = computeEffectiveConfigFromParsed(repoResult.data, localResult.data)

		expect(config.isMissingConfig).toBe(false)
		expect(config.sourceRef).toBe('origin/main')
		expect(config.branchRemote).toBe('origin')
		expect(config.setupCommand).toBe('bun install')
		expect(config.repos.map((repo) => repo.localPath)).toEqual(['.', '../api'])
		expect(config.repos.every((repo) => repo.setupCommand === 'bun install')).toBe(true)
		expect(config.repos.map((repo) => repo.branchRemote)).toEqual(['origin', 'fork'])
	})
})
