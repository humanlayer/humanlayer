import { toast } from 'sonner'

export interface DiffShareSearch {
	readonly diffPresentation?: 'sidebar' | 'primary' | 'fullscreen'
	readonly diffFileId?: string
	readonly diffCommentId?: string
}

/**
 * Generate direct riptide-ui URLs for sharing tasks and sessions.
 * The deep=true search param lets the web page attempt native app handoff.
 */

function getShareUrl(path: string, search?: DiffShareSearch): string {
	const baseUrl = import.meta.env.VITE_PUBLIC_APP_ORIGIN || window.location.origin
	const params = new URLSearchParams({ deep: 'true' })
	if (search?.diffPresentation) params.set('diffPresentation', search.diffPresentation)
	if (search?.diffFileId) params.set('diffFileId', search.diffFileId)
	if (search?.diffCommentId) params.set('diffCommentId', search.diffCommentId)
	return `${baseUrl}${path}?${params.toString()}`
}

export function getTaskShareUrl(taskId: string, search?: DiffShareSearch): string {
	return getShareUrl(`/tasks/${taskId}`, search)
}

export async function copyTaskDeepLink(taskId: string, search?: DiffShareSearch): Promise<void> {
	const shareUrl = getTaskShareUrl(taskId, search)
	await navigator.clipboard.writeText(shareUrl)
	toast.success(search ? 'Review link copied to clipboard' : 'Task app link copied to clipboard')
}

export function getSessionShareUrl(sessionId: string, search?: DiffShareSearch): string {
	return getShareUrl(`/sessions/${sessionId}`, search)
}

export async function copySessionDeepLink(sessionId: string, search?: DiffShareSearch): Promise<void> {
	const shareUrl = getSessionShareUrl(sessionId, search)
	await navigator.clipboard.writeText(shareUrl)
	toast.success(search ? 'Review link copied to clipboard' : 'Session app link copied to clipboard')
}
