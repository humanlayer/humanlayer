import { useSettingsStore } from '@/hooks/stores/settingsStore'

export const COMMENT_NOTIFICATION_BURST_WINDOW_MS = 2_000

interface NotificationSoundSettings {
	notificationSoundsEnabled: boolean
	notificationVolume: number
}

interface CommentNotificationSoundPlayerOptions {
	now: () => number
	getSettings: () => NotificationSoundSettings
	createAudio: (src: string) => HTMLAudioElement
}

export function createCommentNotificationSoundPlayer(
	options: Partial<CommentNotificationSoundPlayerOptions> = {},
): () => void {
	const now = options.now ?? Date.now
	const getSettings = options.getSettings ?? (() => useSettingsStore.getState())
	const createAudio = options.createAudio ?? ((src) => new Audio(src))
	let lastRequestAt: number | null = null

	return () => {
		const settings = getSettings()
		if (!settings.notificationSoundsEnabled) return

		const requestedAt = now()
		const isSameBurst = lastRequestAt !== null && requestedAt - lastRequestAt < COMMENT_NOTIFICATION_BURST_WINDOW_MS
		lastRequestAt = requestedAt
		if (isSameBurst) return

		const audio = createAudio('/sounds/notification.mp3')
		audio.volume = settings.notificationVolume
		audio.play().catch(() => {})
	}
}

export const playCommentNotificationSound = createCommentNotificationSoundPlayer()
