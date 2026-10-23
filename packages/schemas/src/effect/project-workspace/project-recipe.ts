import { Struct } from 'effect'
import * as Schema from 'effect/Schema'

export const NormalizedRepositoryIdentity = Schema.NonEmptyString.check(
	Schema.isPattern(/^[a-z0-9.-]+\/[a-zA-Z0-9._~/-]+$/),
)
export type NormalizedRepositoryIdentity = typeof NormalizedRepositoryIdentity.Type

/** Returns the repository name from a normalized `host/owner/repository` identity. */
export function repositoryNameFromIdentity(repositoryIdentity: string): string {
	return repositoryIdentity.slice(repositoryIdentity.lastIndexOf('/') + 1)
}

export function hasRepositoryUrlCredentials(remoteUrl: string): boolean {
	const trimmed = remoteUrl.trim().replace(/[\t\r\n]/g, '')
	const httpAuthority = /^https?:[\\/]+([^\\/?#]*)/i.exec(trimmed)?.[1]
	if (httpAuthority?.includes('@')) return true
	const userInfo = /^[a-z][a-z\d+.-]*:\/\/([^/?#]*)@/i.exec(trimmed)?.[1]
	return userInfo?.includes(':') ?? false
}

export const RepositoryRemoteUrl = Schema.NonEmptyString.check(
	Schema.makeFilter((value) =>
		hasRepositoryUrlCredentials(value) ? 'Repository URLs must not contain embedded credentials' : undefined,
	),
)
export type RepositoryRemoteUrl = typeof RepositoryRemoteUrl.Type

export const ProjectRepository = Schema.Struct({
	remoteUrl: RepositoryRemoteUrl,
	repositoryIdentity: NormalizedRepositoryIdentity,
	defaultBranch: Schema.NonEmptyString,
	default: Schema.Boolean,
	description: Schema.optionalKey(Schema.NonEmptyString),
	autoPushBranch: Schema.Boolean,
	copyGlobs: Schema.Array(Schema.String).pipe(Schema.mutable),
	setupCommand: Schema.optionalKey(Schema.String),
}).mapFields(Struct.map(Schema.mutableKey))
export type ProjectRepository = typeof ProjectRepository.Type

export const ProjectRepositories = Schema.Array(ProjectRepository)
	.pipe(Schema.mutable, Schema.check(Schema.isMinLength(1)))
	.check(
		Schema.makeFilter((repositories) =>
			new Set(repositories.map((repository) => repository.repositoryIdentity)).size === repositories.length
				? undefined
				: { path: [], issue: 'project repositories must have unique repository identities' },
		),
		Schema.makeFilter((repositories) =>
			repositories.filter((repository) => repository.default).length === 1
				? undefined
				: { path: [], issue: 'project repositories must contain exactly one default repository' },
		),
	)
export type ProjectRepositories = typeof ProjectRepositories.Type

export const ProjectRepositoryPaths = Schema.Record(NormalizedRepositoryIdentity, Schema.NonEmptyString)
export type ProjectRepositoryPaths = typeof ProjectRepositoryPaths.Type

export function normalizeRepositoryIdentity(remoteUrl: string): string | undefined {
	const trimmed = remoteUrl.trim()
	if (trimmed.length === 0) return undefined

	const urlMatch = /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?([^/:\s]+)(?::\d+)?\/(.+)$/.exec(trimmed)
	if (urlMatch) return normalizeHostAndPath(urlMatch[1], urlMatch[2])

	const scpMatch = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed)
	return scpMatch ? normalizeHostAndPath(scpMatch[1], scpMatch[2]) : undefined
}

function normalizeHostAndPath(host: string | undefined, repositoryPath: string | undefined): string | undefined {
	if (!host || !repositoryPath) return undefined
	const path = repositoryPath.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
	if (path.length === 0 || path.includes('..')) return undefined
	return `${host.toLowerCase()}/${path}`
}
