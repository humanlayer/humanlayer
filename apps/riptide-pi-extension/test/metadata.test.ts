import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import type { Extension } from '@earendil-works/pi-coding-agent'

const root = fileURLToPath(new URL('../', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('Node engines match installed pi', () => {
	const piEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
	const pi = JSON.parse(readFileSync(resolve(dirname(piEntry), '../package.json'), 'utf8'))
	assert.equal(pkg.engines.node, '>=22.19.0')
	assert.equal(pkg.engines.node, pi.engines.node)
})

for (const source of ['installed', 'cli'] as const) {
	test(`${source} package loads once and pi displays pi-humanlayer.ts, not src`, async (t) => {
		const home = await mkdtemp(join(tmpdir(), 'pi-hl-metadata-'))
		const env = process.env
		process.env = {
			HOME: home,
			PI_CODING_AGENT_DIR: join(home, 'agent'),
			HUMANLAYER_RIPTIDE_HOME: join(home, 'riptide'),
			HUMANLAYER_PI_DISABLE: '1',
			JITI_FS_CACHE: '0',
		}
		t.after(async () => {
			process.env = env
			await rm(home, { recursive: true, force: true })
		})
		t.mock.method(globalThis, 'fetch', () => {
			throw new Error('Metadata loading must not use the network')
		})
		const { DefaultResourceLoader, InteractiveMode, SettingsManager } =
			await import('@earendil-works/pi-coding-agent')
		const cwd = join(home, 'project')
		await mkdir(cwd)
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: join(home, 'agent'),
			settingsManager: SettingsManager.inMemory(source === 'installed' ? { packages: [root] } : {}),
			additionalExtensionPaths: source === 'cli' ? [root] : [],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
		})
		await loader.reload()
		const { extensions, errors } = loader.getExtensions()
		assert.deepEqual(errors, [])
		assert.equal(extensions.length, 1)
		const extension = extensions[0]!
		assert.equal(extension.path, resolve(root, pkg.pi.extensions[0]))
		assert.ok(extension.commands.has('humanlayer'))
		assert.ok(extension.flags.has('humanlayer-task'))
		assert.equal(extension.handlers.get('session_start')?.length, 1)
		assert.equal(extension.sourceInfo?.scope, source === 'installed' ? 'user' : 'temporary')

		// Pi has no public label API. Exercise its actual pure formatter without starting a TUI.
		const display = Object.create(InteractiveMode.prototype) as {
			getCompactExtensionLabels(extensions: Extension[]): string[]
		}
		assert.deepEqual(display.getCompactExtensionLabels(extensions), ['pi-humanlayer.ts'])
	})
}
