import { assert, describe, it } from '@effect/vitest'

import { isEnvironmentPath } from '../../src/effects/services/task-diff/environment-path'

describe('isEnvironmentPath', () => {
	it('matches environment path segments and filenames', () => {
		for (const filePath of [
			'.env',
			'.env.local',
			'.env.production',
			'config/.env/secrets.txt',
			'nested/.env.production',
			'example.env',
			'nested/example.env',
			'config\\.env.local\\secret.txt',
		]) {
			assert.isTrue(isEnvironmentPath(filePath), `${filePath} should be excluded`)
		}
	})

	it('keeps ordinary paths', () => {
		for (const filePath of [
			'env',
			'environment.ts',
			'example.env.ts',
			'src/config.ts',
			'docs/environment/example.md',
			'.en/config.ts',
		]) {
			assert.isFalse(isEnvironmentPath(filePath), `${filePath} should be retained`)
		}
	})

	it('excludes renames when either the old or new path matches', () => {
		const isExcludedRename = (oldPath: string, newPath: string) =>
			isEnvironmentPath(oldPath) || isEnvironmentPath(newPath)

		assert.isTrue(isExcludedRename('.env.previous', 'config.ts'))
		assert.isTrue(isExcludedRename('config.ts', 'config/example.env'))
		assert.isFalse(isExcludedRename('config.old.ts', 'config.ts'))
	})
})
