import type { DiscoveredGitRepository } from '@humanlayer/riptide-electron-rpc'
import { useQuery } from '@tanstack/react-query'
import { useDebounce } from '@uidotdev/usehooks'

import { validateDirectoryExists } from '@/integrations/desktop/filesystem'
import { discoverGitRepositories } from '@/integrations/desktop/repository-discovery'

export type RepositoryDiscoveryResult =
	| { readonly status: 'invalid'; readonly message: string }
	| { readonly status: 'ok'; readonly repositories: ReadonlyArray<DiscoveredGitRepository> }

export async function discoverRepositoryDirectory(
	directory: string,
	discover: (directory: string) => Promise<ReadonlyArray<DiscoveredGitRepository>>,
): Promise<RepositoryDiscoveryResult> {
	const path = directory.trim().replace(/\/+$/, '') || '/'

	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			(async (): Promise<RepositoryDiscoveryResult> => {
				const validation = await validateDirectoryExists(path)
				if (!validation.valid)
					return { status: 'invalid', message: validation.error ?? 'Directory does not exist' }
				const repositories = await discover(path)
				return {
					status: 'ok',
					repositories,
				}
			})(),
			new Promise<RepositoryDiscoveryResult>((resolve) => {
				timer = setTimeout(
					() =>
						resolve({
							status: 'invalid',
							message: 'Repository discovery timed out. Check the desktop connection and try again.',
						}),
					15_000,
				)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Debounced typed-path → validation → Git discovery, following the
 * RepositoryDirectoryDialog query pattern: the queryKey change discards
 * superseded results, and `isChecking` covers the debounce window so a stale
 * "not found" never flashes while the user is still typing.
 */
export function useRepositoryDiscovery(
	directory: string,
	discover: (directory: string) => Promise<ReadonlyArray<DiscoveredGitRepository>> = discoverGitRepositories,
) {
	const debouncedDirectory = useDebounce(directory, 300)
	const trimmed = debouncedDirectory.trim()

	const query = useQuery({
		queryKey: ['project-repository-discovery', trimmed.replace(/\/+$/, '') || '/'],
		queryFn: () => discoverRepositoryDirectory(trimmed, discover),
		staleTime: 30_000,
		retry: false,
		enabled: trimmed.length > 0,
	})

	const matchesCurrentInput = trimmed === directory.trim()
	const isChecking = directory.trim().length > 0 && (!matchesCurrentInput || query.isPending)

	let result: RepositoryDiscoveryResult | undefined
	if (matchesCurrentInput && !isChecking) {
		result = query.data
		if (query.isError)
			result = {
				status: 'invalid',
				message: 'Could not search this directory. Check that it is accessible on this computer.',
			}
	}
	return {
		result,
		isChecking,
		retry: () => {
			void query.refetch()
		},
	}
}
