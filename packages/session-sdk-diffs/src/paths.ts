// Paths a task diff never includes.

/** An env file: a path segment starting with `.env`, or a file name ending in `.env`. */
export function isEnvironmentPath(filePath: string): boolean {
	const segments = filePath.split(/[\\/]/)
	const filename = segments.at(-1)
	return segments.some((segment) => segment.startsWith('.env')) || filename?.endsWith('.env') === true
}

/** An env file, or anything under a `.humanlayer/` folder, where task files and their links live. */
export function isPrivateDiffPath(filePath: string): boolean {
	return isEnvironmentPath(filePath) || filePath.split(/[\\/]/).slice(0, -1).includes('.humanlayer')
}
