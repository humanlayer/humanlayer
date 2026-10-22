import { accessSync, constants, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { humanlayerEmbeddedFiles, HUMANLAYER_PLUGIN_VERSION } from '@/plugins/bundled-humanlayer-plugin'
import { embeddedFiles, PLUGIN_VERSION } from '@/plugins/bundled-rpi-plugin'
import {
	ensureRpiPluginOnDisk,
	ensureHumanlayerPluginOnDisk,
	getHumanlayerPluginPath,
	getRpiPluginPath,
} from '@/plugins/ensure-plugin'

import { withEnv } from '../helpers/concurrency'

describe('bundled-rpi-plugin', () => {
	describe('bundled HumanLayer plugin', () => {
		it('embeds the hl skills under the hl plugin', async () => {
			expect(humanlayerEmbeddedFiles['skills/show-me/SKILL.md']).toBeDefined()
			expect(humanlayerEmbeddedFiles['skills/orchestrate/SKILL.md']).toBeDefined()
			expect(humanlayerEmbeddedFiles['skills/teleport/SKILL.md']).toBeDefined()
			expect(humanlayerEmbeddedFiles['skills/teleport/references/secrets.md']).toBeDefined()
			expect(humanlayerEmbeddedFiles['skills/teleport/references/systemd.md']).toBeDefined()
			const manifestPath = humanlayerEmbeddedFiles['.claude-plugin/plugin.json']
			const manifest = JSON.parse(await readFile(manifestPath!, 'utf-8'))
			expect(manifest.name).toBe('hl')
			expect(manifest.version).toBe(HUMANLAYER_PLUGIN_VERSION)
		})

		it('embeds every file in the hl plugin source', async () => {
			const sourceDir = join(import.meta.dirname, '..', '..', '..', 'riptide-humanlayer-claude-plugin')
			const entries = await readdir(sourceDir, { recursive: true, withFileTypes: true })
			const sourceFiles = entries
				.filter((entry) => entry.isFile())
				.map((entry) => join(entry.parentPath, entry.name).slice(sourceDir.length + 1))
			expect(Object.keys(humanlayerEmbeddedFiles).sort()).toEqual(sourceFiles.sort())
		})

		it('materializes the hl skills as a separate built-in plugin', async () => {
			const baseDir = mkdtempSync(join(tmpdir(), 'humanlayer-plugin-test-'))
			try {
				const pluginPath = await withEnv(
					{
						RIPTIDE_HUMANLAYER_PLUGIN_PATH: undefined,
						RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN: undefined,
					},
					() => ensureHumanlayerPluginOnDisk(baseDir),
				)
				expect(pluginPath).toBe(getHumanlayerPluginPath(baseDir))
				expect(existsSync(join(pluginPath, 'skills', 'show-me', 'SKILL.md'))).toBe(true)
				expect(existsSync(join(pluginPath, 'skills', 'orchestrate', 'SKILL.md'))).toBe(true)
				expect(existsSync(join(pluginPath, 'skills', 'teleport', 'SKILL.md'))).toBe(true)
				expect(
					await readFile(join(pluginPath, 'skills', 'teleport', 'references', 'secrets.md'), 'utf-8'),
				).toBe(await readFile(humanlayerEmbeddedFiles['skills/teleport/references/secrets.md'], 'utf-8'))
				expect(existsSync(join(pluginPath, 'skills', 'teleport', 'references', 'systemd.md'))).toBe(true)
			} finally {
				rmSync(baseDir, { recursive: true, force: true })
			}
		})
	})

	describe('embeddedFiles', () => {
		it('should have plugin.json in manifest', () => {
			expect(embeddedFiles['.claude-plugin/plugin.json']).toBeDefined()
		})

		it('should have all expected skills', () => {
			const expectedSkills = [
				'create-plan',
				'iterate-plan',
				'create-research',
				'iterate-research',
				'create-research-questions',
				'iterate-research-questions',
				'create-design-discussion',
				'iterate-design-discussion',
				'create-structure-outline',
				'iterate-structure-outline',
				'implement-plan',
				'setup-worktree',
				'ci-commit',
				'describe-pr',
			]

			for (const skill of expectedSkills) {
				const skillPath = `skills/${skill}/SKILL.md`
				expect(skillPath in embeddedFiles).toBe(true)
			}
		})

		it('should have valid embedded paths that can be read', async () => {
			// Test reading the plugin.json as a sample
			const pluginJsonPath = embeddedFiles['.claude-plugin/plugin.json']
			expect(pluginJsonPath).toBeDefined()
			const content = await readFile(pluginJsonPath!, 'utf-8')
			const parsed = JSON.parse(content)

			expect(parsed.name).toBe('rpi')
			expect(parsed.version).toBe(PLUGIN_VERSION)
		})

		it('should include resolved design discussion final answer templates', () => {
			expect(
				embeddedFiles['skills/create-design-discussion/references/design_discussion_final_answer_resolved.md'],
			).toBeDefined()
			expect(
				embeddedFiles['skills/iterate-design-discussion/references/design_discussion_final_answer_resolved.md'],
			).toBeDefined()
		})

		it('should include create-design-discussion visual guidance', () => {
			expect(embeddedFiles['skills/create-design-discussion/references/show-me.md']).toBeDefined()
		})

		it('should include describe-pr walkthrough diff script', () => {
			expect(embeddedFiles['skills/describe-pr/scripts/inject-walkthrough-diffs.sh']).toBeDefined()
		})
	})

	describe('ensureRpiPluginOnDisk', () => {
		// Use temp directory to avoid polluting user's home directory
		let tempBaseDir: string
		let savedEnvVars: { RIPTIDE_RPI_PLUGIN_PATH?: string; RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN?: string }

		beforeAll(() => {
			tempBaseDir = mkdtempSync(join(tmpdir(), 'rpi-plugin-test-'))
		})

		afterAll(() => {
			// Clean up temp directory after tests
			if (tempBaseDir && existsSync(tempBaseDir)) {
				rmSync(tempBaseDir, { recursive: true, force: true })
			}
		})

		beforeEach(() => {
			// Save and clear dev mode env vars to test bundled plugin behavior
			savedEnvVars = {
				RIPTIDE_RPI_PLUGIN_PATH: process.env.RIPTIDE_RPI_PLUGIN_PATH,
				RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN: process.env.RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN,
			}
			delete process.env.RIPTIDE_RPI_PLUGIN_PATH
			delete process.env.RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN
		})

		afterEach(() => {
			// Restore env vars
			if (savedEnvVars.RIPTIDE_RPI_PLUGIN_PATH !== undefined) {
				process.env.RIPTIDE_RPI_PLUGIN_PATH = savedEnvVars.RIPTIDE_RPI_PLUGIN_PATH
			}
			if (savedEnvVars.RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN !== undefined) {
				process.env.RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN = savedEnvVars.RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN
			}
		})

		it('should write plugin to disk and return path', async () => {
			const expectedPath = getRpiPluginPath(tempBaseDir)
			const pluginPath = await withEnv(
				{
					RIPTIDE_RPI_PLUGIN_PATH: undefined,
					RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN: undefined,
				},
				() => ensureRpiPluginOnDisk(tempBaseDir),
			)

			expect(pluginPath).toBe(expectedPath)
			expect(existsSync(pluginPath)).toBe(true)
		})

		it('should create correct directory structure', async () => {
			const pluginPath = await withEnv(
				{
					RIPTIDE_RPI_PLUGIN_PATH: undefined,
					RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN: undefined,
				},
				() => ensureRpiPluginOnDisk(tempBaseDir),
			)

			// Check plugin.json exists
			const pluginJsonPath = join(pluginPath, '.claude-plugin', 'plugin.json')
			expect(existsSync(pluginJsonPath)).toBe(true)

			// Check a sample skill exists
			const skillPath = join(pluginPath, 'skills', 'create-plan', 'SKILL.md')
			expect(existsSync(skillPath)).toBe(true)

			// Check a reference file exists
			const refPath = join(pluginPath, 'skills', 'create-plan', 'references', 'plan_template.md')
			expect(existsSync(refPath)).toBe(true)

			const describePrScriptPath = join(
				pluginPath,
				'skills',
				'describe-pr',
				'scripts',
				'inject-walkthrough-diffs.sh',
			)
			expect(existsSync(describePrScriptPath)).toBe(true)
			expect(() => accessSync(describePrScriptPath, constants.X_OK)).not.toThrow()
		})

		it('should write correct file contents', async () => {
			const pluginPath = await withEnv(
				{
					RIPTIDE_RPI_PLUGIN_PATH: undefined,
					RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN: undefined,
				},
				() => ensureRpiPluginOnDisk(tempBaseDir),
			)

			// Read and verify plugin.json
			const pluginJsonPath = join(pluginPath, '.claude-plugin', 'plugin.json')
			const pluginJson = JSON.parse(await readFile(pluginJsonPath, 'utf-8'))

			expect(pluginJson.name).toBe('rpi')
			expect(pluginJson.version).toBe(PLUGIN_VERSION)
		})

		it('should be idempotent - return immediately if already exists', async () => {
			// First call creates the directory
			const firstPath = await withEnv(
				{
					RIPTIDE_RPI_PLUGIN_PATH: undefined,
					RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN: undefined,
				},
				() => ensureRpiPluginOnDisk(tempBaseDir),
			)

			// Second call should return same path without error
			const secondPath = await withEnv(
				{
					RIPTIDE_RPI_PLUGIN_PATH: undefined,
					RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN: undefined,
				},
				() => ensureRpiPluginOnDisk(tempBaseDir),
			)

			expect(secondPath).toBe(firstPath)
			expect(existsSync(secondPath)).toBe(true)
		})

		it('should write all expected files', async () => {
			const pluginPath = await withEnv(
				{
					RIPTIDE_RPI_PLUGIN_PATH: undefined,
					RIPTIDE_DAEMON_FORCE_LOCAL_PLUGIN: undefined,
				},
				() => ensureRpiPluginOnDisk(tempBaseDir),
			)

			// Verify all files from manifest exist
			for (const relativePath of Object.keys(embeddedFiles)) {
				const fullPath = join(pluginPath, relativePath)
				expect(existsSync(fullPath)).toBe(true)
			}
		})
	})

	describe('PLUGIN_VERSION', () => {
		it('should match the embedded plugin.json version', async () => {
			const pluginJsonPath = embeddedFiles['.claude-plugin/plugin.json']
			expect(pluginJsonPath).toBeDefined()
			const content = await readFile(pluginJsonPath!, 'utf-8')
			const parsed = JSON.parse(content)

			expect(PLUGIN_VERSION).toBe(parsed.version)
		})
	})
})
