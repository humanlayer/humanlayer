import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const channel = process.argv[2] ?? 'local'
if (!['local', 'dev', 'beta', 'prod'].includes(channel)) {
	throw new Error(`Unsupported daemon channel: ${channel}`)
}

const electronDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(electronDirectory, '../..')
const daemonDirectory = resolve(repositoryRoot, 'apps/riptide-daemon')
const exitCode = await new Promise<number>((resolveExit, reject) => {
	const child = spawn(
		'bun',
		['--bun', 'turbo', 'run', `build:${channel}`, '--filter', '@humanlayer/riptide-daemon'],
		{
			cwd: repositoryRoot,
			stdio: 'inherit',
		},
	)
	child.once('error', reject)
	child.once('exit', (code) => resolveExit(code ?? 1))
})
if (exitCode !== 0) throw new Error(`Daemon build failed with exit code ${exitCode}`)

const source = resolve(daemonDirectory, 'dist/daemon')
const destination = resolve(electronDirectory, 'resources/bin/riptided')
await mkdir(dirname(destination), { recursive: true })
await copyFile(source, destination)
await chmod(destination, 0o755)
