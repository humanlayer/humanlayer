import { spawnSync } from 'node:child_process'

export function hasCommand(command: string): boolean {
	const result = spawnSync('command', ['-v', command], { shell: true, stdio: 'ignore' })
	return result.status === 0
}
