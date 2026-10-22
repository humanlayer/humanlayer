import { homedir } from 'node:os'

import { describe, expect, test } from 'vitest'

import {
	type Activation,
	activeProfile,
	getActiveCollection,
	getActiveCollectionName,
	matchesActivation,
	migrateConfig,
	type RpiConfig,
} from '../config'

describe('migrateConfig', () => {
	test('migrates legacy artifactsRepo to collections.default', () => {
		const legacy = {
			artifactsRepo: '/tmp/artifacts',
			linearIntegrationEnabled: true,
		}

		const result = migrateConfig(legacy)

		expect(result.collections?.default).toBeDefined()
		const defaultCollection = result.collections?.default
		if (defaultCollection === undefined) throw new Error('invariant: default collection missing')
		expect(defaultCollection.artifactsRepo).toBe('/tmp/artifacts')
		expect(defaultCollection.linearIntegrationEnabled).toBe(true)
		expect(result.defaultCollection).toBe('default')
	})

	test('preserves existing collections and ignores legacy artifactsRepo', () => {
		const config = {
			artifactsRepo: '/old/path',
			collections: {
				default: { artifactsRepo: '/new/path' },
			},
		}

		const result = migrateConfig(config)

		const defaultCollection = result.collections?.default
		if (defaultCollection === undefined) throw new Error('invariant: default collection missing')
		expect(defaultCollection.artifactsRepo).toBe('/new/path')
	})

	test('keeps worktree_base_path at top level', () => {
		const config = {
			artifactsRepo: '/tmp/artifacts',
			worktree_base_path: '/tmp/worktrees',
		}

		const result = migrateConfig(config)

		expect(result.worktree_base_path).toBe('/tmp/worktrees')
	})

	test('throws when no config at all', () => {
		expect(() => migrateConfig({})).toThrow('No artifactsRepo configured')
	})
})

describe('matchesActivation', () => {
	test('matches exact path', () => {
		const activation: Activation = { match: '/repos/syncopate', collection: 'work' }
		expect(matchesActivation(activation, '/repos/syncopate')).toBe(true)
		expect(matchesActivation(activation, '/repos/other')).toBe(false)
	})

	test('matches wildcard pattern', () => {
		const activation: Activation = { match: '/repos/*', collection: 'work' }
		expect(matchesActivation(activation, '/repos/syncopate')).toBe(true)
		expect(matchesActivation(activation, '/repos/other')).toBe(true)
		expect(matchesActivation(activation, '/other/syncopate')).toBe(false)
	})

	test('matches double-star pattern for nested paths', () => {
		const activation: Activation = { match: '/repos/**', collection: 'work' }
		expect(matchesActivation(activation, '/repos/syncopate')).toBe(true)
		expect(matchesActivation(activation, '/repos/syncopate/packages/db')).toBe(true)
	})

	test('expands tilde in activation pattern', () => {
		const activation: Activation = { match: '~/repos/*', collection: 'personal' }
		const home = homedir()
		expect(matchesActivation(activation, `${home}/repos/myproject`)).toBe(true)
		expect(matchesActivation(activation, '/other/repos/myproject')).toBe(false)
	})

	test('returns false for invalid glob pattern', () => {
		const activation: Activation = { match: '[invalid', collection: 'work' }
		expect(matchesActivation(activation, '/any/path')).toBe(false)
	})
})

describe('activeProfile', () => {
	test('returns first matching activation', () => {
		const config: RpiConfig = {
			collections: {
				work: { artifactsRepo: '/work/artifacts' },
				personal: { artifactsRepo: '/personal/artifacts' },
			},
			activations: [
				{ match: '/repos/work/**', collection: 'work' },
				{ match: '/repos/**', collection: 'personal' },
			],
		}

		expect(activeProfile('/repos/work/project', config)).toBe('work')
		expect(activeProfile('/repos/personal/project', config)).toBe('personal')
	})

	test('returns null when no activation matches', () => {
		const config: RpiConfig = {
			collections: { work: { artifactsRepo: '/work' } },
			activations: [{ match: '/repos/*', collection: 'work' }],
		}

		expect(activeProfile('/other/path', config)).toBeNull()
	})

	test('returns null when no activations defined', () => {
		const config: RpiConfig = {
			collections: { work: { artifactsRepo: '/work' } },
		}

		expect(activeProfile('/any/path', config)).toBeNull()
	})
})

describe('getActiveCollection', () => {
	test('returns matched activation collection', () => {
		const config: RpiConfig = {
			collections: {
				work: { artifactsRepo: '/work/artifacts', linearIntegrationEnabled: false },
				default: { artifactsRepo: '/default/artifacts' },
			},
			activations: [{ match: '/repos/work/*', collection: 'work' }],
		}

		const result = getActiveCollection('/repos/work/project', config)
		expect(result.artifactsRepo).toBe('/work/artifacts')
		expect(result.linearIntegrationEnabled).toBe(false)
	})

	test('falls back to defaultCollection when no activation matches', () => {
		const config: RpiConfig = {
			collections: {
				custom: { artifactsRepo: '/custom' },
				default: { artifactsRepo: '/default' },
			},
			defaultCollection: 'custom',
		}

		const result = getActiveCollection('/unmatched/path', config)
		expect(result.artifactsRepo).toBe('/custom')
	})

	test('falls back to "default" collection when no defaultCollection set', () => {
		const config: RpiConfig = {
			collections: {
				other: { artifactsRepo: '/other' },
				default: { artifactsRepo: '/default' },
			},
		}

		const result = getActiveCollection('/unmatched/path', config)
		expect(result.artifactsRepo).toBe('/default')
	})

	test('falls back to first collection when no "default" exists', () => {
		const config: RpiConfig = {
			collections: {
				first: { artifactsRepo: '/first' },
				second: { artifactsRepo: '/second' },
			},
		}

		const result = getActiveCollection('/unmatched/path', config)
		expect(result.artifactsRepo).toBe('/first')
	})

	test('throws when no collections exist', () => {
		const config: RpiConfig = { collections: {} }

		expect(() => getActiveCollection('/any/path', config)).toThrow()
	})
})

describe('getActiveCollectionName', () => {
	test('returns collection name not config', () => {
		const config: RpiConfig = {
			collections: {
				work: { artifactsRepo: '/work' },
			},
			activations: [{ match: '/repos/*', collection: 'work' }],
		}

		expect(getActiveCollectionName('/repos/project', config)).toBe('work')
	})

	test('returns defaultCollection name when no activation matches', () => {
		const config: RpiConfig = {
			collections: {
				custom: { artifactsRepo: '/custom' },
				default: { artifactsRepo: '/default' },
			},
			defaultCollection: 'custom',
		}

		expect(getActiveCollectionName('/unmatched/path', config)).toBe('custom')
	})

	test('returns "default" when no defaultCollection set but default exists', () => {
		const config: RpiConfig = {
			collections: {
				other: { artifactsRepo: '/other' },
				default: { artifactsRepo: '/default' },
			},
		}

		expect(getActiveCollectionName('/unmatched/path', config)).toBe('default')
	})

	test('returns first collection name when no default', () => {
		const config: RpiConfig = {
			collections: {
				first: { artifactsRepo: '/first' },
				second: { artifactsRepo: '/second' },
			},
		}

		expect(getActiveCollectionName('/unmatched/path', config)).toBe('first')
	})

	test('throws when no collections configured', () => {
		const config: RpiConfig = { collections: {} }

		expect(() => getActiveCollectionName('/any/path', config)).toThrow('No collections configured')
	})
})
