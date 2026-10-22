import type { GitStatus } from '@pierre/trees'

export interface DiffFileTreeItem {
	/** Workspace-relative path, e.g. `riptide-api/src/routes/get.ts`. */
	path: string
	/** Change badge status for the row. */
	status: GitStatus
	/** Open root comments shown as a row badge. */
	openCommentCount?: number
}
