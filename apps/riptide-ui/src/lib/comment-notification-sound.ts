import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { playNotificationSound } from '@/lib/notification-sound'

export const COMMENT_NOTIFICATION_BURST_WINDOW_MS = 2_000

interface NotificationSoundSettings {
	notificationSoundsEnabled: boolean
	notificationVolume: number
}

interface CommentNotificationSoundPlayerOptions {
	now: () => number
	getSettings: () => NotificationSoundSettings
	playAudio: (volume: number) => void
}

export function createCommentNotificationSoundPlayer(
	options: Partial<CommentNotificationSoundPlayerOptions> = {},
): () => void {
	const now = options.now ?? Date.now
	const getSettings = options.getSettings ?? (() => useSettingsStore.getState())
	const playAudio = options.playAudio ?? playNotificationSound
	let lastRequestAt: number | null = null

	return () => {
		const settings = getSettings()
		if (!settings.notificationSoundsEnabled) return

		const requestedAt = now()
		const isSameBurst = lastRequestAt !== null && requestedAt - lastRequestAt < COMMENT_NOTIFICATION_BURST_WINDOW_MS
		lastRequestAt = requestedAt
		if (isSameBurst) return

		playAudio(settings.notificationVolume)
	}
}

export const playCommentNotificationSound = createCommentNotificationSoundPlayer()
