import { relative, resolve, sep } from 'node:path'

import { isPathWithinBoundary } from './artifact-path-validation'
import { getArtifactStoragePath, getArtifactSymlinkPath } from './artifact-paths'
import { isReservedArtifactTrashSubpath } from './artifact-trash'

export function getArtifactSubpathPrefixes(cwd: string, taskId: string, taskSlug: string | null): string[] {
	const prefixes: string[] = []

	if (taskSlug) {
		prefixes.push(getArtifactSymlinkPath(cwd, taskSlug))
	}

	prefixes.push(getArtifactStoragePath(taskId))

	if (taskSlug) {
		prefixes.push(resolve(cwd, 'rpi', 'tasks', taskSlug))
	}

	prefixes.push(resolve(cwd, 'rpi', 'tasks'))
	prefixes.push(resolve(cwd, 'rpi'))

	return prefixes
}

export function extractArtifactSubpath(fullPath: string, taskDirPrefixes: string[]): string | null {
	const subpath = extractContainedArtifactSubpath(fullPath, taskDirPrefixes)
	return subpath && !isReservedArtifactTrashSubpath(subpath) ? subpath : null
}

export function isArtifactTrashPath(fullPath: string, taskDirPrefixes: string[]): boolean {
	const subpath = extractContainedArtifactSubpath(fullPath, taskDirPrefixes)
	return subpath !== null && isReservedArtifactTrashSubpath(subpath)
}

function extractContainedArtifactSubpath(fullPath: string, taskDirPrefixes: string[]): string | null {
	const resolvedPath = resolve(fullPath)

	for (const taskDirPrefix of taskDirPrefixes) {
		const resolvedPrefix = resolve(taskDirPrefix)
		if (!isPathWithinBoundary(resolvedPath, resolvedPrefix)) {
			continue
		}

		const subpath = relative(resolvedPrefix, resolvedPath)
		if (!subpath || subpath === '.' || subpath.startsWith('..')) {
			continue
		}

		return subpath.split(sep).join('/')
	}

	return null
}
