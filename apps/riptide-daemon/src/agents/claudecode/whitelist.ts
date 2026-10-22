import { homedir } from 'node:os'
import { resolve } from 'node:path'

/**
 * Extract file_path from tool input for Read/Write/Edit tools.
 * Returns undefined if the input doesn't have a file_path field.
 */
export function getFilePath(toolInput: unknown): string | undefined {
	if (typeof toolInput === 'object' && toolInput !== null) {
		const input = toolInput as { file_path?: unknown }
		if (typeof input.file_path === 'string') {
			return input.file_path
		}
	}
	return undefined
}

/**
 * Extract command from Bash tool input.
 * Returns undefined if the input doesn't have a command field.
 */
export function getCommand(toolInput: unknown): string | undefined {
	if (typeof toolInput === 'object' && toolInput !== null) {
		const input = toolInput as { command?: unknown }
		if (typeof input.command === 'string') {
			return input.command
		}
	}
	return undefined
}

/**
 * Check if a Bash command is whitelisted.
 * Whitelists commands starting with 'rpi' (with space delimiter to avoid false positives).
 */
export function isWhitelistedBashCommand(command: string): boolean {
	const trimmed = command.trim()
	return trimmed === 'rpi' || trimmed.startsWith('rpi ')
}

/**
 * Check if a file path is within the artifact directories relative to the working directory.
 * Checks:
 * - rpi/ (legacy)
 * - .humanlayer/tasks/ (symlink path)
 * - ~/.humanlayer/riptide/artifacts/ (UUID storage path)
 * Handles both absolute and relative paths.
 */
export function isArtifactPath(rawPath: string, cwd: string): boolean {
	const filePath = rawPath.startsWith('/') ? rawPath : resolve(cwd, rawPath)
	const rpiPrefix = `${resolve(cwd, 'rpi')}/`
	const humanlayerPrefix = `${resolve(cwd, '.humanlayer', 'tasks')}/`
	const artifactStoragePrefix = `${resolve(homedir(), '.humanlayer', 'riptide', 'artifacts')}/`
	return (
		filePath.startsWith(rpiPrefix) ||
		filePath.startsWith(humanlayerPrefix) ||
		filePath.startsWith(artifactStoragePrefix)
	)
}

/**
 * Main entry point: check if a tool call should be whitelisted.
 * Returns true if the tool call should auto-approve without human intervention.
 */
export function isWhitelisted(toolName: string, input: Record<string, unknown>, cwd: string): boolean {
	// Skill tool is always whitelisted
	if (toolName === 'Skill') {
		return true
	}

	// Bash commands starting with 'linear' or 'rpi' are whitelisted
	if (toolName === 'Bash') {
		const command = getCommand(input)
		if (command && isWhitelistedBashCommand(command)) {
			return true
		}
		return false
	}

	// Read/Write/Edit tools accessing files in artifact directories are whitelisted
	if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
		const filePath = getFilePath(input)
		if (filePath && isArtifactPath(filePath, cwd)) {
			return true
		}
		return false
	}

	// HumanLayer comment MCP tools are whitelisted (low-risk, reversible actions)
	if (
		toolName === 'mcp__humanlayer__get_artifact_comments' ||
		toolName === 'mcp__humanlayer__update_artifact_comments' ||
		toolName === 'mcp__humanlayer__reply_to_artifact_comment' ||
		toolName === 'mcp__humanlayer__get_diff_comments' ||
		toolName === 'mcp__humanlayer__update_diff_comments' ||
		toolName === 'mcp__humanlayer__reply_to_diff_comment'
	) {
		return true
	}

	return false
}
