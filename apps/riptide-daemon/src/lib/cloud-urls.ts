import { APP_ORIGIN, CLOUD_ORIGIN } from '@/lib/macros'
import logger from '@/logger'

/**
 * Construct cloud URL for a task's artifacts list page, or undefined when no cloud origin is set.
 * Pattern: {CLOUD_ORIGIN}/tasks/{taskId}/artifacts
 */
export function getTaskArtifactsCloudUrl(taskId: string): string | undefined {
	if (!CLOUD_ORIGIN) {
		logger.warn('No cloud origin configured (RIPTIDE_CLOUD_ORIGIN); omitting task artifacts link')
		return undefined
	}
	return `${CLOUD_ORIGIN}/tasks/${taskId}/artifacts`
}

/**
 * Construct the shareable task URL, with native app handoff enabled, or undefined when no app
 * origin is set.
 * Pattern: {APP_ORIGIN}/tasks/{taskId}?deep=true
 */
export function getTaskDeepLinkUrl(taskId: string): string | undefined {
	if (!APP_ORIGIN) {
		logger.warn('No app origin configured (RIPTIDE_APP_ORIGIN); omitting task deep link')
		return undefined
	}
	return `${APP_ORIGIN}/tasks/${taskId}?deep=true`
}
