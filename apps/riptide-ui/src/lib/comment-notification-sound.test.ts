import { describe, expect, it, vi } from 'vitest'

import {
	COMMENT_NOTIFICATION_BURST_WINDOW_MS,
	createCommentNotificationSoundPlayer,
} from './comment-notification-sound'

function createAudioStub() {
	return {
		volume: 0,
		play: vi.fn().mockResolvedValue(undefined),
	} as unknown as HTMLAudioElement
}

describe('comment notification sound', () => {
	it('plays once for a burst and waits for a quiet window before playing again', () => {
		let currentTime = 0
		const audio = createAudioStub()
		const createAudio = vi.fn(() => audio)
		const playSound = createCommentNotificationSoundPlayer({
			now: () => currentTime,
			getSettings: () => ({ notificationSoundsEnabled: true, notificationVolume: 0.6 }),
			createAudio,
		})

		playSound()
		for (currentTime = 1_500; currentTime <= 6_000; currentTime += 1_500) playSound()

		expect(createAudio).toHaveBeenCalledOnce()
		expect(audio.play).toHaveBeenCalledOnce()
		expect(audio.volume).toBe(0.6)

		currentTime = 6_000 + COMMENT_NOTIFICATION_BURST_WINDOW_MS
		playSound()

		expect(createAudio).toHaveBeenCalledTimes(2)
		expect(audio.play).toHaveBeenCalledTimes(2)
	})

	it('does not include disabled sound requests in a burst', () => {
		let soundsEnabled = false
		const createAudio = vi.fn(() => createAudioStub())
		const playSound = createCommentNotificationSoundPlayer({
			now: () => 1_000,
			getSettings: () => ({ notificationSoundsEnabled: soundsEnabled, notificationVolume: 1 }),
			createAudio,
		})

		playSound()
		soundsEnabled = true
		playSound()

		expect(createAudio).toHaveBeenCalledOnce()
	})
})
