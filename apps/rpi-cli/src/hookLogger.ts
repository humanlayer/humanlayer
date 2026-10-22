import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function getLogPath(): string {
	if (process.env.RIPTIDE_HOOK_LOG_PATH) {
		return process.env.RIPTIDE_HOOK_LOG_PATH
	}
	const date = new Date().toISOString().split('T')[0]
	return join(homedir(), '.humanlayer', 'riptide', 'logs', `${date}-hooks.log`)
}

function ensureLogDir(logPath: string): void {
	try {
		mkdirSync(dirname(logPath), { recursive: true })
	} catch {
		// Directory may already exist
	}
}

function formatLogMessage(hookName: string, message: string): string {
	const timestamp = new Date().toISOString()
	return `[${timestamp}] [${hookName}] ${message}\n`
}

export function hookLog(hookName: string, message: string): void {
	const formatted = formatLogMessage(hookName, message)

	// Log to stderr
	process.stderr.write(formatted)

	// Log to file
	const logPath = getLogPath()
	ensureLogDir(logPath)
	try {
		appendFileSync(logPath, formatted)
	} catch {
		// Ignore file write errors
	}
}
