import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const SCRIPT = 'ci-scripts/generate-electron-updater-manifest.ts'

let tempDir: string

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'electron-updater-manifest-test-'))
})

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true })
})

function run(env: Record<string, string>) {
	const cleanEnv: Record<string, string> = {
		PATH: process.env.PATH!,
		HOME: process.env.HOME!,
	}
	for (const [k, v] of Object.entries(env)) {
		cleanEnv[k] = v
	}
	return execSync(`bun run ${SCRIPT}`, {
		encoding: 'utf-8',
		cwd: process.cwd(),
		env: cleanEnv,
	})
}

function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
	const outputPath = join(tempDir, 'output', 'latest-mac.yml')
	return {
		VERSION: '0.161.7',
		RELEASE_TAG: 'humanlayer-electron-dev-v0.161.7-20260819120000',
		ZIP_FILENAME: 'HumanLayerElectronDev-0.161.7-arm64.zip',
		ZIP_SHA512: 'abc123base64sha512==',
		ZIP_SIZE: '91750016',
		OUTPUT_PATH: outputPath,
		...overrides,
	}
}

function readYaml(outputPath: string): Record<string, unknown> {
	const content = readFileSync(outputPath, 'utf-8')
	// Simple YAML parser for the flat structure we produce.
	// Parses top-level keys and the single files[] entry.
	const result: Record<string, unknown> = {}
	const lines = content.split('\n')
	let inFiles = false
	let currentFile: Record<string, unknown> = {}

	for (const line of lines) {
		if (line === 'files:') {
			inFiles = true
			continue
		}
		if (inFiles && line.startsWith('  - ')) {
			// Start of a file entry
			const [key, ...rest] = line.slice(4).split(': ')
			currentFile[key] = rest.join(': ')
			continue
		}
		if (inFiles && line.startsWith('    ')) {
			// Continuation of a file entry
			const [key, ...rest] = line.slice(4).split(': ')
			currentFile[key] = rest.join(': ')
			continue
		}
		if (inFiles && !line.startsWith(' ') && line.trim() !== '') {
			// Exited files block
			inFiles = false
			result.files = [currentFile]
		}
		if (!inFiles && line.trim() !== '') {
			const colonIdx = line.indexOf(': ')
			if (colonIdx !== -1) {
				const key = line.slice(0, colonIdx)
				let value: string | unknown = line.slice(colonIdx + 2)
				// Strip surrounding quotes
				if (typeof value === 'string' && value.startsWith("'") && value.endsWith("'")) {
					value = value.slice(1, -1)
				}
				result[key] = value
			}
		}
	}

	if (inFiles && Object.keys(currentFile).length > 0) {
		result.files = [currentFile]
	}

	return result
}

describe('generate-electron-updater-manifest', () => {
	describe('happy path', () => {
		test('generates valid latest-mac.yml', () => {
			const env = validEnv()
			run(env)
			const manifest = readYaml(env.OUTPUT_PATH)

			expect(manifest.version).toBe('0.161.7')
			expect(manifest.files).toBeDefined()
			const files = manifest.files as Record<string, unknown>[]
			expect(files).toHaveLength(1)
			expect(files[0].sha512).toBe('abc123base64sha512==')
			expect(files[0].size).toBe('91750016')
		})

		test('constructs correct download URL', () => {
			const env = validEnv()
			run(env)
			const manifest = readYaml(env.OUTPUT_PATH)
			const files = manifest.files as Record<string, unknown>[]

			expect(files[0].url).toBe(
				'https://github.com/humanlayer/homebrew-humanlayer/releases/download/humanlayer-electron-dev-v0.161.7-20260819120000/HumanLayerElectronDev-0.161.7-arm64.zip',
			)
		})

		test('includes releaseDate as ISO string', () => {
			const env = validEnv()
			run(env)
			const manifest = readYaml(env.OUTPUT_PATH)

			expect(manifest.releaseDate).toBeDefined()
			expect(() => new Date(manifest.releaseDate as string)).not.toThrow()
			expect(manifest.releaseDate as string).toMatch(/^\d{4}-\d{2}-\d{2}T/)
		})
	})

	describe('output directory', () => {
		test('creates parent directories', () => {
			const outputPath = join(tempDir, 'a', 'b', 'c', 'latest-mac.yml')
			const env = validEnv({ OUTPUT_PATH: outputPath })
			run(env)
			const manifest = readYaml(outputPath)
			expect(manifest.version).toBe('0.161.7')
		})
	})

	describe('YAML structure', () => {
		test('produces valid YAML content', () => {
			const env = validEnv()
			run(env)
			const raw = readFileSync(env.OUTPUT_PATH, 'utf-8')

			// Should start with version
			expect(raw).toMatch(/^version: 0\.161\.7\n/)
			// Should have files block
			expect(raw).toContain('files:\n')
			// Should have releaseDate
			expect(raw).toContain('releaseDate:')
			// Should end with a trailing newline
			expect(raw).toMatch(/\n$/)
		})

		test('uses different tag and filename', () => {
			const env = validEnv({
				VERSION: '2.0.0',
				RELEASE_TAG: 'humanlayer-electron-v2.0.0',
				ZIP_FILENAME: 'HumanLayerElectron-2.0.0-arm64.zip',
				ZIP_SHA512: 'someSha512Base64==',
				ZIP_SIZE: '100000000',
			})
			run(env)
			const manifest = readYaml(env.OUTPUT_PATH)
			const files = manifest.files as Record<string, unknown>[]

			expect(manifest.version).toBe('2.0.0')
			expect(files[0].url).toBe(
				'https://github.com/humanlayer/homebrew-humanlayer/releases/download/humanlayer-electron-v2.0.0/HumanLayerElectron-2.0.0-arm64.zip',
			)
			expect(files[0].sha512).toBe('someSha512Base64==')
			expect(files[0].size).toBe('100000000')
		})
	})

	describe('error handling', () => {
		test('errors when VERSION is missing', () => {
			const env = validEnv()
			delete (env as Record<string, string | undefined>).VERSION
			expect(() => run(env)).toThrow()
		})

		test('errors when RELEASE_TAG is missing', () => {
			const env = validEnv()
			delete (env as Record<string, string | undefined>).RELEASE_TAG
			expect(() => run(env)).toThrow()
		})

		test('errors when ZIP_FILENAME is missing', () => {
			const env = validEnv()
			delete (env as Record<string, string | undefined>).ZIP_FILENAME
			expect(() => run(env)).toThrow()
		})

		test('errors when ZIP_SHA512 is missing', () => {
			const env = validEnv()
			delete (env as Record<string, string | undefined>).ZIP_SHA512
			expect(() => run(env)).toThrow()
		})

		test('errors when ZIP_SIZE is missing', () => {
			const env = validEnv()
			delete (env as Record<string, string | undefined>).ZIP_SIZE
			expect(() => run(env)).toThrow()
		})

		test('errors when OUTPUT_PATH is missing', () => {
			const env = validEnv()
			delete (env as Record<string, string | undefined>).OUTPUT_PATH
			expect(() => run(env)).toThrow()
		})
	})
})
