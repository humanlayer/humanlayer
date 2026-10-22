import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

import { conflictingCaddyProcesses, ensureCaddy } from '../apps/devstack/src/lib/caddy'

// Devstack is opt-in: only worktrees that have adopted it carry a `.devstack.json`. When it is
// absent, this is a plain `bun run riptide` checkout, so keep the legacy per-worktree Caddy process
// in the foreground alongside Turbo. Sync writes desired routing state; launch commands call this
// guard to activate shared Caddy without interrupting an in-progress workspace setup flow.
try {
	await access(join(process.cwd(), '.devstack.json'))
} catch (error) {
	if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
		const caddy = spawn('caddy', ['run', '--config', 'Caddyfile'], { stdio: 'inherit' })
		process.exitCode = await new Promise<number>((resolve, reject) => {
			caddy.once('error', reject)
			caddy.once('exit', (code) => resolve(code ?? 1))
		})
		process.exit()
	}
	throw error
}

const registryPath = process.env.DEVSTACK_REGISTRY_PATH
if (!registryPath) throw new Error('Missing DEVSTACK_REGISTRY_PATH; run `bun --bun run devstack sync` first')

try {
	const conflicts = await conflictingCaddyProcesses(registryPath)
	if (conflicts.length > 0) {
		const details = conflicts.map((process) => `  PID ${process.pid}: ${process.command}`).join('\n')
		throw new Error(
			`Another Caddy process is competing with devstack on the shared listeners:\n${details}\n\nStop the conflicting process, then run \`bun --bun run riptide\` again.`,
		)
	}
	await ensureCaddy(registryPath)
} catch (error) {
	process.stderr.write(
		`\n========== DEVSTACK CADDY WARNING ==========\n${error instanceof Error ? error.message : String(error)}\n============================================\n`,
	)
	process.exitCode = 1
}
