/**
 * The notification chime plays through Web Audio, not `new Audio()`. In WebKit a playing
 * HTMLMediaElement makes the app the macOS Now Playing app, so Play/Pause replays the chime
 * instead of the user's music.
 *
 * Do not set navigator.audioSession.type to "playback" or "play-and-record" in this app: an
 * AudioContext can then take Now Playing too.
 */

const NOTIFICATION_SOUND_URL = '/sounds/notification.mp3'
// An autoplay policy holds resume() until the page may play, then resolves every waiting call at
// once. Of the sounds that waited longer than this, only the newest plays, so blocked chimes do not
// stack up. A single late sound still plays.
const MAX_RESUME_WAIT_MS = 1_000

let audioContext: AudioContext | null = null
let notificationBuffer: Promise<AudioBuffer> | null = null
let playingSources = 0
let latestRequest = 0

function getAudioContext(): AudioContext {
	if (!audioContext) {
		audioContext = new AudioContext()
	}
	return audioContext
}

function loadNotificationBuffer(ctx: AudioContext): Promise<AudioBuffer> {
	if (!notificationBuffer) {
		const loading = fetch(NOTIFICATION_SOUND_URL)
			.then((response) => response.arrayBuffer())
			.then((data) => ctx.decodeAudioData(data))
		loading.catch(() => {
			notificationBuffer = null
		})
		notificationBuffer = loading
	}
	return notificationBuffer
}

async function playSound(volume: number): Promise<void> {
	const ctx = getAudioContext()
	// Counted from the request, so an onended that runs while this sound loads or resumes
	// does not suspend the context under it.
	playingSources += 1
	const request = ++latestRequest
	let started = false
	try {
		const buffer = await loadNotificationBuffer(ctx)

		// Always resume: a suspend() queued when the previous sound ended can still be pending,
		// and in WebKit ctx.state reads "running" until it runs.
		const resumeRequestedAt = performance.now()
		await ctx.resume()
		if (performance.now() - resumeRequestedAt > MAX_RESUME_WAIT_MS && request !== latestRequest) return

		const source = ctx.createBufferSource()
		source.buffer = buffer

		const gainNode = ctx.createGain()
		gainNode.gain.value = volume

		source.connect(gainNode)
		gainNode.connect(ctx.destination)
		source.onended = () => releaseSource(ctx)
		source.start()
		started = true
	} finally {
		if (!started) releaseSource(ctx)
	}
}

function releaseSource(ctx: AudioContext): void {
	playingSources -= 1
	// A running context keeps the output device running even when it is silent.
	if (playingSources === 0) ctx.suspend().catch(() => {})
}

export function playNotificationSound(volume: number): void {
	playSound(volume).catch(() => {})
}
