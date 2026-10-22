import type { FC } from 'react'

export interface GitHubRepositoriesWithoutAppNoteProps {
	repositories: readonly string[]
	/** Settings is admin-only, so it is offered to nobody else. */
	isAdmin: boolean
	onOpenSettings: () => void
}

/** Under the sections: the repositories of the same scope that have no pull requests to show. */
export const GitHubRepositoriesWithoutAppNote: FC<GitHubRepositoriesWithoutAppNoteProps> = ({
	repositories,
	isAdmin,
	onOpenSettings,
}) => (
	<div
		className="flex flex-wrap items-center gap-1 px-1 pb-2 text-[10px] text-muted-foreground"
		data-testid="github-repositories-without-app"
	>
		<span className="min-w-0 truncate">HumanLayer was not granted access to {repositories.join(', ')}</span>
		{isAdmin ? (
			<>
				<span aria-hidden>·</span>
				<button
					type="button"
					onClick={onOpenSettings}
					className="text-accent transition-colors hover:text-accent/80"
				>
					Open settings
				</button>
			</>
		) : null}
	</div>
)
