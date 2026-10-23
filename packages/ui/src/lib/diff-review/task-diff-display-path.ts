export interface TaskDiffDisplayPathFile {
	readonly repoId: string
	readonly repoDisplayName?: string
	readonly path: string
}

/** Formats a diff path without exposing the repository's on-disk directory name. */
export function taskDiffDisplayPath(file: TaskDiffDisplayPathFile): string {
	const repository = file.repoDisplayName ?? file.repoId
	return repository && repository !== '.' ? `${repository}/${file.path}` : file.path
}
