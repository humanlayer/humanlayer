import type { GitHubRepository } from '@humanlayer/riptide-api-contract/api/integrations/github/schemas'
import { Badge } from '@humanlayer/ui/components/badge'
import { Input } from '@humanlayer/ui/components/input'
import { Archive, GitBranch, Loader2, Lock, Search } from 'lucide-react'
import { useState } from 'react'

export interface GitHubRepositoryListProps {
	/** Persisted inventory for one connection, from `integrations.github.listRepositories`. */
	readonly repositories?: ReadonlyArray<GitHubRepository>
	readonly loading?: boolean
	readonly error?: boolean
}

/**
 * Pure searchable repository detail for one installation. Data comes from the persisted
 * inventory; the component owns only the local search query. Loading, error, empty, and
 * no-match states are deterministic from props so they can be exercised directly in Storybook.
 */
export function GitHubRepositoryList({ repositories, loading = false, error = false }: GitHubRepositoryListProps) {
	const [query, setQuery] = useState('')

	if (loading) {
		return (
			<div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
				<Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading repositories…
			</div>
		)
	}

	if (error) {
		return (
			<p className="rounded-md border border-dashed p-3 text-sm text-destructive">
				Could not load repositories. Refresh this connection to try again.
			</p>
		)
	}

	const allRepositories = repositories ?? []

	if (allRepositories.length === 0) {
		return (
			<p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
				No repositories are available for this installation yet.
			</p>
		)
	}

	const normalizedQuery = query.trim().toLowerCase()
	const matches = normalizedQuery
		? allRepositories.filter((repository) => repository.fullName.toLowerCase().includes(normalizedQuery))
		: allRepositories

	return (
		<div className="space-y-2">
			<div className="relative">
				<Search
					className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search repositories…"
					aria-label="Search repositories"
					className="pl-8"
				/>
			</div>
			{matches.length === 0 ? (
				<p className="px-1 py-3 text-sm text-muted-foreground">No repositories match "{query}".</p>
			) : (
				<ul className="max-h-64 space-y-1 overflow-y-auto">
					{matches.map((repository) => (
						<li
							key={repository.id}
							data-repository-id={repository.id}
							className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
						>
							<div className="min-w-0">
								<p className="truncate text-sm font-medium">{repository.fullName}</p>
								<p className="flex items-center gap-1 text-xs text-muted-foreground">
									<GitBranch className="size-3" aria-hidden="true" />
									{repository.defaultBranch}
								</p>
							</div>
							<div className="flex shrink-0 items-center gap-1.5">
								{repository.archived && (
									<Badge variant="outline" className="gap-1 text-muted-foreground">
										<Archive className="size-3" aria-hidden="true" /> Archived
									</Badge>
								)}
								<Badge variant={repository.private ? 'secondary' : 'outline'} className="gap-1">
									{repository.private ? (
										<>
											<Lock className="size-3" aria-hidden="true" /> Private
										</>
									) : (
										'Public'
									)}
								</Badge>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	)
}
