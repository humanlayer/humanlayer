import type { RepositorySourceSelection, RepositorySourceSelections } from '@humanlayer/schemas/zod/project-workspace'
import { isDefinedError, ORPCError } from '@orpc/client'

export function compactRepositorySourcePath(path: string, homeDirectory: string | null): string {
	const value = path.trim()
	if (!homeDirectory || value === '~' || value.startsWith('~/')) return value
	const normalizedValue = value.replaceAll('\\', '/')
	const normalizedHome = homeDirectory.replaceAll('\\', '/').replace(/\/+$/, '')
	if (normalizedValue === normalizedHome) return '~'
	if (normalizedValue.startsWith(`${normalizedHome}/`)) return `~/${normalizedValue.slice(normalizedHome.length + 1)}`
	return value
}

export function missingRepositorySources(sources: RepositorySourceSelections | undefined): string[] {
	if (!sources) return []
	return Object.entries(sources).flatMap(([identity, source]) => (source.kind === 'unknown' ? [identity] : []))
}

export function repositorySourceSummary(sources: RepositorySourceSelections | undefined): string {
	if (!sources) return 'Loading repository sources…'
	const selections = Object.values(sources)
	const unknown = selections.filter((source) => source.kind === 'unknown').length
	if (unknown > 0) return 'Repository sources will be chosen at launch'
	const filesystem = selections.filter((source) => source.kind === 'filesystem').length
	const managed = selections.length - filesystem
	const parts: string[] = []
	if (filesystem > 0) parts.push(`${filesystem} existing ${filesystem === 1 ? 'checkout' : 'checkouts'}`)
	if (managed > 0) parts.push(`${managed} managed ${managed === 1 ? 'clone' : 'clones'}`)
	return parts.join(' · ')
}

export function initialRepositorySourceSelections(
	sources: RepositorySourceSelections,
	allowUnknown: boolean,
): RepositorySourceSelections {
	return Object.fromEntries(
		Object.entries(sources).map(([identity, source]) => [
			identity,
			source.kind === 'unknown' && !allowUnknown
				? ({ kind: 'managed_clone' } satisfies RepositorySourceSelection)
				: source,
		]),
	)
}

export function isRepositorySourcesRequiredError(error: unknown): boolean {
	return error instanceof ORPCError && isDefinedError(error) && error.code === 'REPOSITORY_SOURCES_REQUIRED'
}
