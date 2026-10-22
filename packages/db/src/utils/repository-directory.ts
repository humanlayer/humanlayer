import type { WorkspaceSpec } from '@humanlayer/schemas/effect/workspace'

type PathRoot = { kind: 'relative' | 'home' | 'posix' | 'drive' | 'unc'; value: string }
type PortablePath = { root: PathRoot; segments: string[] }

export interface RepositoryPlacement {
	repositoryDirectory: string
	repositories: Array<{
		localPath: string
		creatorPath: string
		relativePath: string
		primary: boolean
	}>
}

function parsePortablePath(value: string): PortablePath {
	const normalized = value.trim().replaceAll('\\', '/')
	if (!normalized) throw new Error('Path must not be empty')

	const drive = /^([A-Za-z]:)(?:\/(.*))?$/.exec(normalized)
	const unc = /^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(normalized)
	let root: PathRoot
	let remainder: string
	if (unc) {
		root = { kind: 'unc', value: `//${unc[1]}/${unc[2]}` }
		remainder = unc[3] ?? ''
	} else if (drive) {
		const driveLetter = drive[1]
		if (driveLetter === undefined) throw new Error(`Malformed drive path: ${value}`)
		root = { kind: 'drive', value: driveLetter.toUpperCase() }
		remainder = drive[2] ?? ''
	} else if (normalized === '~' || normalized.startsWith('~/')) {
		root = { kind: 'home', value: '~' }
		remainder = normalized.slice(1)
	} else if (normalized.startsWith('/')) {
		root = { kind: 'posix', value: '/' }
		remainder = normalized.slice(1)
	} else {
		root = { kind: 'relative', value: '' }
		remainder = normalized
	}

	const segments: string[] = []
	for (const segment of remainder.split('/')) {
		if (!segment || segment === '.') continue
		if (segment === '..') {
			if (segments.length > 0 && segments.at(-1) !== '..') segments.pop()
			else if (root.kind === 'relative') segments.push(segment)
			else throw new Error(`Path traverses above its filesystem root: ${value}`)
		} else segments.push(segment)
	}
	return { root, segments }
}

function formatPortablePath(path: PortablePath): string {
	const suffix = path.segments.join('/')
	if (path.root.kind === 'relative') return suffix || '.'
	if (path.root.kind === 'posix') return suffix ? `/${suffix}` : '/'
	if (path.root.kind === 'drive') return suffix ? `${path.root.value}/${suffix}` : `${path.root.value}/`
	return suffix ? `${path.root.value}/${suffix}` : path.root.value
}

function rootsEqual(left: PathRoot, right: PathRoot): boolean {
	if (left.kind !== right.kind) return false
	if (left.kind === 'drive' || left.kind === 'unc') return left.value.toLowerCase() === right.value.toLowerCase()
	return left.value === right.value
}

export function normalizePortablePath(value: string): string {
	return formatPortablePath(parsePortablePath(value))
}

export function joinPortablePath(base: string, child: string): string {
	if (parsePortablePath(child).root.kind !== 'relative') return normalizePortablePath(child)
	return normalizePortablePath(`${base}/${child}`)
}

function relativePortablePath(parent: PortablePath, child: PortablePath): string {
	if (!rootsEqual(parent.root, child.root)) throw new Error('Repository paths use incompatible filesystem roots')
	if (parent.segments.some((segment, index) => child.segments[index] !== segment)) {
		throw new Error('Repository path is outside the repository directory')
	}
	return child.segments.slice(parent.segments.length).join('/') || '.'
}

export function deriveRepositoryPlacement(workspaceSpec: WorkspaceSpec): RepositoryPlacement {
	const paths = workspaceSpec.repos.map((repo) =>
		parsePortablePath(joinPortablePath(workspaceSpec.directory, repo.localPath)),
	)
	const first = paths[0]
	if (!first) throw new Error('Workspace must declare at least one repository')
	if (paths.some((candidate) => !rootsEqual(first.root, candidate.root))) {
		throw new Error('Repository paths use incompatible filesystem roots')
	}

	let commonLength = paths.length === 1 ? Math.max(0, first.segments.length - 1) : first.segments.length
	for (const candidate of paths.slice(1)) {
		let index = 0
		while (index < commonLength && first.segments[index] === candidate.segments[index]) index += 1
		commonLength = index
	}
	const repositoryDirectory = { root: first.root, segments: first.segments.slice(0, commonLength) }
	return {
		repositoryDirectory: formatPortablePath(repositoryDirectory),
		repositories: workspaceSpec.repos.map((repo, index) => {
			const repoPath = paths[index]
			if (repoPath === undefined) throw new Error(`Repository path missing for repo index ${index}`)
			return {
				localPath: repo.localPath,
				creatorPath: formatPortablePath(repoPath),
				relativePath: relativePortablePath(repositoryDirectory, repoPath),
				primary: repo.primary,
			}
		}),
	}
}

function relativeFromPrimary(primaryDirectory: string, repositoryDirectory: string): string {
	const primary = parsePortablePath(primaryDirectory)
	const repository = parsePortablePath(repositoryDirectory)
	if (!rootsEqual(primary.root, repository.root)) throw new Error('Resolved repositories use incompatible roots')
	let commonLength = 0
	while (
		commonLength < primary.segments.length &&
		primary.segments[commonLength] === repository.segments[commonLength]
	)
		commonLength += 1
	return (
		[
			...Array.from({ length: primary.segments.length - commonLength }, () => '..'),
			...repository.segments.slice(commonLength),
		].join('/') || '.'
	)
}

export function resolveRepositoryWorkspaceSpec(
	workspaceSpec: WorkspaceSpec,
	selectedRepositoryDirectory: string,
): WorkspaceSpec {
	const destination = normalizePortablePath(selectedRepositoryDirectory)
	const placement = deriveRepositoryPlacement(workspaceSpec)
	const resolvedPaths = placement.repositories.map((repo) => joinPortablePath(destination, repo.relativePath))
	const primaryIndex = workspaceSpec.repos.findIndex((repo) => repo.primary)
	const primaryDirectory = resolvedPaths[primaryIndex]
	if (!primaryDirectory) throw new Error('Workspace must declare exactly one primary repository')
	return {
		...workspaceSpec,
		directory: primaryDirectory,
		repos: workspaceSpec.repos.map((repo, index) => {
			const resolvedPath = resolvedPaths[index]
			if (resolvedPath === undefined) throw new Error(`Resolved path missing for repo index ${index}`)
			return {
				...repo,
				localPath: relativeFromPrimary(primaryDirectory, resolvedPath),
			}
		}),
	}
}

export function resolveSingleRepositoryWorkspaceSpec(
	workspaceSpec: WorkspaceSpec,
	selectedCheckoutDirectory: string,
): WorkspaceSpec {
	const repository = workspaceSpec.repos[0]
	if (workspaceSpec.repos.length !== 1 || !repository) {
		throw new Error('Single-repository workspace resolution requires exactly one repository')
	}
	return {
		...workspaceSpec,
		directory: normalizePortablePath(selectedCheckoutDirectory),
		repos: [{ ...repository, localPath: '.' }],
	}
}

export function getPrimaryTargetDirectory(workspaceSpec: WorkspaceSpec): string {
	const primary = workspaceSpec.repos.find((repo) => repo.primary)
	if (!primary) throw new Error('Workspace must declare exactly one primary repository')
	return normalizePortablePath(primary.targetPath)
}
