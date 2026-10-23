import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, expect, test } from 'vitest'

import { embedPhotonWasmLoader } from '../scripts/bun-build-plugins/embed-photon-wasm'

const temporaryDirectories: string[] = []
const repositoryRoot = join(import.meta.dirname, '..')
const installedPhotonDirectory = join(
	repositoryRoot,
	'node_modules',
	'.bun',
	'node_modules',
	'@silvia-odwyer',
	'photon-node',
)

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
	)
})

test('embeds Photon WASM in a standalone executable', async () => {
	const fixture = await mkdtemp(join(tmpdir(), 'embed-photon-wasm-'))
	temporaryDirectories.push(fixture)

	const photonDirectory = join(fixture, 'node_modules', '@silvia-odwyer', 'photon-node')
	await mkdir(dirname(photonDirectory), { recursive: true })
	await cp(installedPhotonDirectory, photonDirectory, { recursive: true, dereference: true })
	await writeFile(
		join(fixture, 'entry.ts'),
		"const photon = await import('@silvia-odwyer/photon-node')\nconsole.log(typeof photon.PhotonImage)\n",
	)

	const executable = join(fixture, process.platform === 'win32' ? 'photon-test.exe' : 'photon-test')
	await writeFile(
		join(fixture, 'build.ts'),
		`import { embedPhotonWasmPlugin } from ${JSON.stringify(pathToFileURL(join(repositoryRoot, 'scripts', 'bun-build-plugins', 'embed-photon-wasm.ts')).href)}
const result = await Bun.build({
	entrypoints: [${JSON.stringify(join(fixture, 'entry.ts'))}],
	target: 'bun',
	plugins: [embedPhotonWasmPlugin],
	compile: { outfile: ${JSON.stringify(executable)} },
})
if (!result.success) throw new AggregateError(result.logs, 'Failed to compile Photon embedding fixture')
`,
	)
	const buildResult = spawnSync('bun', ['run', join(fixture, 'build.ts')], { cwd: fixture, encoding: 'utf8' })
	expect(buildResult.status, buildResult.stderr).toBe(0)

	// A release ships only the executable. Removing the build-time package proves Photon reads Bun's embedded WASM.
	await rm(join(fixture, 'node_modules'), { recursive: true, force: true })
	const processResult = spawnSync(executable, { cwd: fixture, encoding: 'utf8' })

	expect(processResult.status, processResult.stderr).toBe(0)
	expect(processResult.stdout).toBe('function\n')
	expect(processResult.stderr).toBe('')
})

test('fails clearly when Photon changes its WASM loader', () => {
	expect(() => embedPhotonWasmLoader('module.exports = {}\n', '/fixture/photon_rs.js')).toThrow(
		'Expected one Photon WASM runtime lookup in /fixture/photon_rs.js, found 0',
	)
})
