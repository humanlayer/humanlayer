import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const script = resolve('ci-scripts/generate-electron-homebrew-cask.ts')
let temporaryDirectory: string

beforeEach(() => {
	temporaryDirectory = mkdtempSync(join(tmpdir(), 'electron-homebrew-cask-'))
})

afterEach(() => {
	rmSync(temporaryDirectory, { recursive: true, force: true })
})

function validEnvironment(releaseType = 'dev'): Record<string, string> {
	return {
		PATH: process.env.PATH!,
		HOME: process.env.HOME!,
		RELEASE_TYPE: releaseType,
		RELEASE_VERSION: '1.2.3',
		SHA256: 'abc123',
		DMG_URL:
			'https://github.com/humanlayer/homebrew-humanlayer/releases/download/humanlayer-electron-dev-v1.2.3/HumanLayerElectronDev-1.2.3-arm64.dmg',
		OUTPUT_DIR: join(temporaryDirectory, 'Casks'),
	}
}

function run(environment: Record<string, string>): string {
	return execFileSync('bun', ['run', script], { cwd: process.cwd(), env: environment, encoding: 'utf8' })
}

describe('generate-electron-homebrew-cask', () => {
	test.each(['dev', 'beta', 'prod'])('omits deprecated verified metadata in the %s cask', (releaseType) => {
		const environment = validEnvironment(releaseType)
		run(environment)
		const suffix = releaseType === 'prod' ? '' : `-${releaseType}`
		const cask = readFileSync(join(environment.OUTPUT_DIR, `humanlayer-electron${suffix}.rb`), 'utf8')
		expect(cask).toContain(`  url "${environment.DMG_URL}"\n`)
		expect(cask).not.toContain('verified:')
		expect(cask).toContain(`sha256 "${environment.SHA256}"`)
	})

	test('generates only the humanlayer Electron dev cask', () => {
		const environment = validEnvironment()
		const stdout = run(environment)
		const humanLayerPath = join(environment.OUTPUT_DIR, 'humanlayer-electron-dev.rb')

		expect(stdout).toContain(`cask_path=${humanLayerPath}`)
		expect(stdout).not.toContain('riptide-electron-dev.rb')
		expect(() => readFileSync(join(environment.OUTPUT_DIR, 'riptide-electron-dev.rb'))).toThrow()
		expect(() => readFileSync(join(environment.OUTPUT_DIR, 'humanlayer-dev.rb'))).toThrow()
		expect(() => readFileSync(join(environment.OUTPUT_DIR, 'riptide-dev.rb'))).toThrow()
	})

	test('uses Electron dev identity, artifact, app, daemon, and coexistence-safe paths', () => {
		const environment = validEnvironment()
		run(environment)
		const cask = readFileSync(join(environment.OUTPUT_DIR, 'humanlayer-electron-dev.rb'), 'utf8')

		expect(cask).toContain('cask "humanlayer-electron-dev"')
		expect(cask).toContain('version "1.2.3"')
		expect(cask).toContain('sha256 "abc123"')
		expect(cask).toContain(`url "${environment.DMG_URL}"`)
		expect(cask).toContain('name "HumanLayerElectronDev"')
		expect(cask).toContain('app "HumanLayerElectronDev.app"')
		expect(cask).toContain('Contents/Resources/bin/riptided", target: "riptided-electron-dev"')
		expect(cask).not.toContain('conflicts_with')
		expect(cask).toContain('depends_on arch: :arm64')
		expect(cask).toContain('~/.humanlayer/electrondata/dev')
		expect(cask).not.toContain('~/.humanlayer/riptide/electron/dev')
		expect(cask).not.toContain('com.humanlayer.riptide.dev')
	})

	test.each([
		['beta', 'HumanLayerElectronBeta', 'humanlayer-electron-beta', 'riptided-electron-beta'],
		['prod', 'HumanLayerElectron', 'humanlayer-electron', 'riptided-electron'],
	])('supports the isolated %s Electron channel', (releaseType, productName, slug, daemonTarget) => {
		const environment = validEnvironment(releaseType)
		run(environment)
		const cask = readFileSync(join(environment.OUTPUT_DIR, `${slug}.rb`), 'utf8')
		expect(cask).toContain(`name "${productName}"`)
		expect(cask).toContain(`target: "${daemonTarget}"`)
	})

	test.each(['RELEASE_TYPE', 'RELEASE_VERSION', 'SHA256', 'DMG_URL', 'OUTPUT_DIR'])('rejects missing %s', (key) => {
		const environment = validEnvironment()
		delete environment[key]
		expect(() => run(environment)).toThrow()
	})

	test('rejects an unknown release channel', () => {
		expect(() => run(validEnvironment('staging'))).toThrow()
	})
})
