import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const cliDir = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(cliDir, 'package.json'), 'utf8')) as {
	bin: Record<string, string>
	files: string[]
}

// The published @humanlayer/cli package is only package.json plus the launchers
// named in `bin`. If a launcher is missing from git, npm publishes a package
// with no command and nothing else fails.
describe('@humanlayer/cli npm package', () => {
	for (const [name, target] of Object.entries(pkg.bin)) {
		it(`ships the ${name} launcher at ${target}`, () => {
			expect(pkg.files).toContain(target)
			const file = path.join(cliDir, target)
			expect(fs.existsSync(file), `${target} is missing`).toBe(true)
			expect(fs.statSync(file).mode & 0o111, `${target} is not executable`).not.toBe(0)
			const tracked = execFileSync('git', ['ls-files', '--', target], { cwd: cliDir, encoding: 'utf8' })
			expect(tracked.trim(), `${target} is not tracked by git`).toBe(target)
		})
	}
})
