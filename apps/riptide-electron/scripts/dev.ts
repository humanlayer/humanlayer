import { spawn, type ChildProcess } from 'node:child_process'
import { watch } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let electron: ChildProcess | undefined
let rebuilding = false
let rebuildQueued = false

async function run(command: string, args: string[]) {
	return new Promise<void>((resolvePromise, reject) => {
		const child = spawn(command, args, { cwd: packageDirectory, env: process.env, stdio: 'inherit' })
		child.once('exit', (code) =>
			code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code}`)),
		)
	})
}

async function restart() {
	if (rebuilding) {
		rebuildQueued = true
		return
	}
	rebuilding = true
	electron?.kill('SIGTERM')
	await run('bun', ['run', 'build:main'])
	const electronArgs =
		process.env.RIPTIDE_ELECTRON_DISABLE_CDP === 'true'
			? ['.']
			: [`--remote-debugging-port=${process.env.RIPTIDE_ELECTRON_CDP_PORT ?? '9222'}`, '.']
	electron = spawn('electron', electronArgs, { cwd: packageDirectory, env: process.env, stdio: 'inherit' })
	rebuilding = false
	if (rebuildQueued) {
		rebuildQueued = false
		await restart()
	}
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(resolve(packageDirectory, 'src'), { recursive: true }, () => {
	clearTimeout(timer)
	timer = setTimeout(() => void restart(), 100)
})

process.on('SIGINT', () => {
	electron?.kill('SIGTERM')
	process.exit(0)
})
process.on('SIGTERM', () => {
	electron?.kill('SIGTERM')
	process.exit(0)
})

await restart()
