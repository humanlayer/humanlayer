import { ORPCError } from '@orpc/client'
import { describe, expect, test } from 'vitest'

import {
	compactRepositorySourcePath,
	initialRepositorySourceSelections,
	isRepositorySourcesRequiredError,
	missingRepositorySources,
	repositorySourceSummary,
} from './repository-sources'

describe('repository source helpers', () => {
	test('compacts only paths within the local home and preserves tilde and external paths', () => {
		expect(compactRepositorySourcePath('/Users/alice/code/app', '/Users/alice')).toBe('~/code/app')
		expect(compactRepositorySourcePath('/Users/alice-two/app', '/Users/alice')).toBe('/Users/alice-two/app')
		expect(compactRepositorySourcePath('/Volumes/repos/app', '/Users/alice')).toBe('/Volumes/repos/app')
		expect(compactRepositorySourcePath('~/code/app', '/Users/alice')).toBe('~/code/app')
	})

	test('supports mixed selections and defaults unknown launch choices to managed', () => {
		const sources = {
			'github.com/team/one': { kind: 'filesystem' as const, path: '~/one' },
			'github.com/team/two': { kind: 'managed_clone' as const },
			'github.com/team/three': { kind: 'unknown' as const },
		}
		expect(missingRepositorySources(sources)).toEqual(['github.com/team/three'])
		expect(repositorySourceSummary(sources)).toBe('Repository sources will be chosen at launch')
		expect(initialRepositorySourceSelections(sources, false)['github.com/team/three']).toEqual({
			kind: 'managed_clone',
		})
		expect(initialRepositorySourceSelections(sources, true)['github.com/team/three']).toEqual({ kind: 'unknown' })
	})

	test('summarizes complete mixed selections', () => {
		expect(
			repositorySourceSummary({
				'github.com/team/one': { kind: 'filesystem', path: '/one' },
				'github.com/team/two': { kind: 'filesystem', path: '/two' },
				'github.com/team/three': { kind: 'managed_clone' },
			}),
		).toBe('2 existing checkouts · 1 managed clone')
	})

	test('recognizes the authoritative source requirement error', () => {
		expect(
			isRepositorySourcesRequiredError(
				new ORPCError('REPOSITORY_SOURCES_REQUIRED', { defined: true, status: 409, data: {} }),
			),
		).toBe(true)
		expect(isRepositorySourcesRequiredError(new Error('REPOSITORY_SOURCES_REQUIRED'))).toBe(false)
	})
})
