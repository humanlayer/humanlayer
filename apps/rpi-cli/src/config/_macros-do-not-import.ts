/**
 * Bun macros for build-time configuration.
 * This file should NEVER be imported directly except by ./macros.ts with {type: 'macro'}
 * Learn more: https://bun.com/docs/bundler/macros
 */
import path from 'node:path'

import * as Schema from 'effect/Schema'

const BuildPackage = Schema.Struct({ version: Schema.String })

export async function BuildVersionMacro(): Promise<string> {
	const pkgPath = path.join(import.meta.dir, '..', '..', 'package.json')
	const pkg = Schema.decodeUnknownSync(BuildPackage)(await Bun.file(pkgPath).json())
	if (!Bun.semver.satisfies(pkg.version, '*')) {
		throw new Error('Build version must be a valid semantic version')
	}
	return pkg.version
}

export function CommitHashMacro() {
	const { stdout } = Bun.spawnSync({
		cmd: ['git', 'rev-parse', 'HEAD'],
		stdout: 'pipe',
	})

	return stdout.toString().trim()
}
