import { toast } from 'sonner'

import { openExternalUrl } from '@/integrations/desktop/external-url'
import { logger } from '@/lib/logger'

/**
 * Open a URL in the system browser (Tauri) or a new tab (browser).
 */
export async function openExternal(url: string): Promise<void> {
	try {
		await openExternalUrl(url)
	} catch (error) {
		logger.error('[url-opener] Failed to open URL:', error)
		throw error
	}
}

/**
 * Open a riptide-cloud URL, or say why not when the build has no cloud origin (see getCloudOrigin).
 */
export function openCloudUrl(url: string | undefined): void {
	if (!url) {
		toast.error('Could not open HumanLayer Cloud', {
			description: 'This build has no cloud address. Set VITE_PUBLIC_CLOUD_ORIGIN and rebuild.',
		})
		return
	}
	void openExternal(url)
}
