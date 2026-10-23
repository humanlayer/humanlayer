import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, test, expect, afterAll } from 'vitest'

const SCRIPT = resolve('ci-scripts/stamp-version.ts')
const STAMPED_FILES = [
	'apps/riptide-native/tauri.conf.json',
	'apps/riptide-native/Cargo.toml',
	'apps/riptide-electron/electron-builder.yml',
]

const fixtureDirs: string[] = []

afterAll(() => {
	for (const dir of fixtureDirs) {
		rmSync(dir, { recursive: true, force: true })
	}
})

// Copy the real build files so the test exercises the actual file shapes
function initFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), 'stamp-version-'))
	fixtureDirs.push(dir)
	mkdirSync(join(dir, 'apps/riptide-native'), { recursive: true })
	mkdirSync(join(dir, 'apps/riptide-electron'), { recursive: true })
	for (const file of STAMPED_FILES) {
		copyFileSync(resolve(file), join(dir, file))
	}
	return dir
}

function run(env: Record<string, string>, cwd: string) {
	const cleanEnv: Record<string, string> = {
		PATH: process.env.PATH!,
		HOME: process.env.HOME!,
	}
	for (const [k, v] of Object.entries(env)) {
		cleanEnv[k] = v
	}
	return execSync(`bun run "${SCRIPT}"`, { encoding: 'utf-8', cwd, env: cleanEnv })
}

describe('stamp-version', () => {
	test('stamps the version into Tauri and Electron build metadata', () => {
		const dir = initFixture()
		run({ VERSION: '9.9.9' }, dir)

		const tauriConf = JSON.parse(readFileSync(join(dir, 'apps/riptide-native/tauri.conf.json'), 'utf-8'))
		expect(tauriConf.version).toBe('9.9.9')

		const cargoToml = readFileSync(join(dir, 'apps/riptide-native/Cargo.toml'), 'utf-8')
		expect(cargoToml).toMatch(/^version = "9\.9\.9"$/m)

		const electronBuilder = readFileSync(join(dir, 'apps/riptide-electron/electron-builder.yml'), 'utf-8')
		expect(electronBuilder).toMatch(/^\s+version: 9\.9\.9$/m)
	})

	test('leaves everything except the version field untouched', () => {
		const dir = initFixture()
		const tauriBefore = JSON.parse(readFileSync(join(dir, 'apps/riptide-native/tauri.conf.json'), 'utf-8'))
		const cargoLinesBefore = readFileSync(join(dir, 'apps/riptide-native/Cargo.toml'), 'utf-8').split('\n')
		const electronLinesBefore = readFileSync(
			join(dir, 'apps/riptide-electron/electron-builder.yml'),
			'utf-8',
		).split('\n')

		run({ VERSION: '9.9.9' }, dir)

		const tauriAfter = JSON.parse(readFileSync(join(dir, 'apps/riptide-native/tauri.conf.json'), 'utf-8'))
		expect(tauriAfter).toEqual({ ...tauriBefore, version: '9.9.9' })

		const cargoLinesAfter = readFileSync(join(dir, 'apps/riptide-native/Cargo.toml'), 'utf-8').split('\n')
		const changed = cargoLinesAfter.filter((line, i) => line !== cargoLinesBefore[i])
		expect(changed).toEqual(['version = "9.9.9"'])

		const electronLinesAfter = readFileSync(join(dir, 'apps/riptide-electron/electron-builder.yml'), 'utf-8').split(
			'\n',
		)
		const changedElectronLines = electronLinesAfter.filter((line, i) => line !== electronLinesBefore[i])
		expect(changedElectronLines).toEqual(['  version: 9.9.9'])
	})

	test('errors when VERSION is missing', () => {
		const dir = initFixture()
		expect(() => run({}, dir)).toThrow()
	})

	test('errors when VERSION is not plain x.y.z', () => {
		const dir = initFixture()
		expect(() => run({ VERSION: '1.2.3-beta.1' }, dir)).toThrow()
	})
})
