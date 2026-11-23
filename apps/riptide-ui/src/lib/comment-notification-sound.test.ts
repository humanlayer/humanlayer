import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notification-sound', () => ({ playNotificationSound: vi.fn() }))

import { playNotificationSound } from '@/lib/notification-sound'

import {
	COMMENT_NOTIFICATION_BURST_WINDOW_MS,
	createCommentNotificationSoundPlayer,
} from './comment-notification-sound'

describe('comment notification sound', () => {
	it('plays once for a burst and waits for a quiet window before playing again', () => {
		let currentTime = 0
		const playAudio = vi.fn()
		const playSound = createCommentNotificationSoundPlayer({
			now: () => currentTime,
			getSettings: () => ({ notificationSoundsEnabled: true, notificationVolume: 0.6 }),
			playAudio,
		})

		playSound()
		for (currentTime = 1_500; currentTime <= 6_000; currentTime += 1_500) playSound()

		expect(playAudio).toHaveBeenCalledOnce()
		expect(playAudio).toHaveBeenCalledWith(0.6)

		currentTime = 6_000 + COMMENT_NOTIFICATION_BURST_WINDOW_MS
		playSound()

		expect(playAudio).toHaveBeenCalledTimes(2)
	})

	it('does not include disabled sound requests in a burst', () => {
		let soundsEnabled = false
		const playAudio = vi.fn()
		const playSound = createCommentNotificationSoundPlayer({
			now: () => 1_000,
			getSettings: () => ({ notificationSoundsEnabled: soundsEnabled, notificationVolume: 1 }),
			playAudio,
		})

		playSound()
		soundsEnabled = true
		playSound()

		expect(playAudio).toHaveBeenCalledOnce()
	})

	it('plays the shared notification sound by default', () => {
		const playSound = createCommentNotificationSoundPlayer({
			now: () => 0,
			getSettings: () => ({ notificationSoundsEnabled: true, notificationVolume: 0.7 }),
		})

		playSound()

		expect(playNotificationSound).toHaveBeenCalledWith(0.7)
	})
})
