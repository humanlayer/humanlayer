import { join, resolve } from 'node:path'

/**
 * Check if a resolved path is within a boundary directory.
 * Uses resolve() to canonicalize paths and trailing-slash prefix check.
 */
export function isPathWithinBoundary(resolvedPath: string, boundaryDir: string): boolean {
	const normalizedPath = resolve(resolvedPath)
	const normalizedBoundary = `${resolve(boundaryDir)}/`
	return normalizedPath.startsWith(normalizedBoundary)
}

export type PathValidationResult = { valid: true; filePath: string } | { valid: false; reason: string }

/**
 * Validate that a filename will produce a path within the task directory.
 * Returns the validated file path or a rejection reason.
 */
export function validateArtifactWritePath(fileName: string, taskDir: string): PathValidationResult {
	const filePath = join(taskDir, fileName)
	const resolvedPath = resolve(filePath)

	if (!isPathWithinBoundary(resolvedPath, taskDir)) {
		return {
			valid: false,
			reason: `Path '${resolvedPath}' escapes task directory '${taskDir}'`,
		}
	}

	return { valid: true, filePath: resolvedPath }
}
