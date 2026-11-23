import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startMock = vi.fn()
const connectMock = vi.fn()
const decodeAudioDataMock = vi.fn()
const resumeMock = vi.fn()
const suspendMock = vi.fn()
const createBufferSourceMock = vi.fn()
const createGainMock = vi.fn()

const fakeBuffer = {} as AudioBuffer
let sources: { buffer: unknown; onended: (() => void) | null }[] = []
let contexts: { destination: object }[] = []

function stubAudioContext() {
	createBufferSourceMock.mockImplementation(() => {
		const source = { buffer: null, onended: null, connect: connectMock, start: startMock }
		sources.push(source)
		return source
	})
	createGainMock.mockReturnValue({
		gain: { value: 1 },
		connect: connectMock,
	})
	decodeAudioDataMock.mockResolvedValue(fakeBuffer)
	resumeMock.mockResolvedValue(undefined)
	suspendMock.mockResolvedValue(undefined)

	vi.stubGlobal(
		'AudioContext',
		class {
			state = 'running'
			destination = { node: 'destination' }
			resume = resumeMock
			suspend = suspendMock
			createBufferSource = createBufferSourceMock
			createGain = createGainMock
			decodeAudioData = decodeAudioDataMock
			constructor() {
				contexts.push(this)
			}
		},
	)
}

describe('notification sound', () => {
	beforeEach(() => {
		vi.resetModules()
		sources = []
		contexts = []

		stubAudioContext()

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
			}),
		)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it('fetches and decodes audio data', async () => {
		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(1)
		await vi.waitFor(() => expect(startMock).toHaveBeenCalled())

		expect(fetch).toHaveBeenCalledWith('/sounds/notification.mp3')
		expect(decodeAudioDataMock).toHaveBeenCalled()
		expect(sources[0]?.buffer).toBe(fakeBuffer)
	})

	it('plays the source through a GainNode set to the volume', async () => {
		const gainConnect = vi.fn()
		const gainNode = { gain: { value: 1 }, connect: gainConnect }
		createGainMock.mockReturnValue(gainNode)

		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(0.4)
		await vi.waitFor(() => expect(startMock).toHaveBeenCalled())

		expect(gainNode.gain.value).toBe(0.4)
		expect(connectMock).toHaveBeenCalledExactlyOnceWith(gainNode)
		expect(gainConnect).toHaveBeenCalledOnce()
		expect(gainConnect.mock.calls[0]?.[0]).toBe(contexts[0]?.destination)
	})

	it('caches the decoded sound across calls', async () => {
		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(1)
		await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(1))
		playNotificationSound(0.5)
		await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(2))

		expect(fetch).toHaveBeenCalledTimes(1)
		expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
		expect(createBufferSourceMock).toHaveBeenCalledTimes(2)
	})

	it('loads the sound once for sounds requested before the first load finishes', async () => {
		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(1)
		playNotificationSound(1)
		await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(2))

		expect(fetch).toHaveBeenCalledTimes(1)
		expect(decodeAudioDataMock).toHaveBeenCalledTimes(1)
	})

	it('loads the sound again after a failed load', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(1)
		await vi.waitFor(() => expect(suspendMock).toHaveBeenCalledOnce())
		playNotificationSound(1)
		await vi.waitFor(() => expect(startMock).toHaveBeenCalledOnce())

		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it('does not leak a rejection when the sound fails to load', async () => {
		const unhandled = vi.fn()
		process.on('unhandledRejection', unhandled)
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

		try {
			const { playNotificationSound } = await import('./notification-sound')
			playNotificationSound(1)
			await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
			await new Promise((resolve) => setTimeout(resolve, 0))

			expect(unhandled).not.toHaveBeenCalled()
		} finally {
			process.off('unhandledRejection', unhandled)
		}
	})

	it('suspends the context once the last sound ends', async () => {
		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(1)
		playNotificationSound(1)
		await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(2))

		sources[0]?.onended?.()
		expect(suspendMock).not.toHaveBeenCalled()

		sources[1]?.onended?.()
		expect(suspendMock).toHaveBeenCalledOnce()
		expect(contexts).toHaveLength(1)
	})

	it('resumes the context before the next sound while a suspend is still pending', async () => {
		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(1)
		await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(1))
		sources[0]?.onended?.()

		resumeMock.mockClear()
		playNotificationSound(1)
		await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(2))

		expect(suspendMock).toHaveBeenCalledOnce()
		expect(resumeMock).toHaveBeenCalledOnce()
		expect(resumeMock.mock.invocationCallOrder[0]).toBeGreaterThan(suspendMock.mock.invocationCallOrder[0] ?? 0)
		expect(resumeMock.mock.invocationCallOrder[0]).toBeLessThan(startMock.mock.invocationCallOrder[1] ?? 0)
	})

	it('does not suspend the context while the next sound is still resuming', async () => {
		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(1)
		await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(1))

		let finishResume = () => {}
		resumeMock.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				finishResume = resolve
			}),
		)
		playNotificationSound(1)
		await vi.waitFor(() => expect(resumeMock).toHaveBeenCalledTimes(2))
		sources[0]?.onended?.()
		finishResume()
		await vi.waitFor(() => expect(startMock).toHaveBeenCalledTimes(2))

		expect(suspendMock).not.toHaveBeenCalled()
	})

	it('suspends the context when the sound fails to load', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(1)

		await vi.waitFor(() => expect(suspendMock).toHaveBeenCalledOnce())
	})

	it('plays a lone sound whose resume took more than a second', async () => {
		let now = 0
		vi.spyOn(performance, 'now').mockImplementation(() => now)
		let finishResume = () => {}
		resumeMock.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				finishResume = resolve
			}),
		)

		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(1)
		await vi.waitFor(() => expect(resumeMock).toHaveBeenCalledOnce())
		now = 1_200
		finishResume()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(startMock).toHaveBeenCalledOnce()
	})

	it('plays only the newest of the sounds that waited on resume together', async () => {
		let now = 0
		vi.spyOn(performance, 'now').mockImplementation(() => now)
		const blockedResumes: (() => void)[] = []
		resumeMock.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					blockedResumes.push(resolve)
				}),
		)
		const gainNode = { gain: { value: 1 }, connect: connectMock }
		createGainMock.mockReturnValue(gainNode)

		const { playNotificationSound } = await import('./notification-sound')
		playNotificationSound(0.1)
		playNotificationSound(0.2)
		playNotificationSound(0.3)
		await vi.waitFor(() => expect(blockedResumes).toHaveLength(3))
		now = 300
		playNotificationSound(0.4)
		await vi.waitFor(() => expect(blockedResumes).toHaveLength(4))
		now = 1_500
		for (const resolve of blockedResumes) resolve()
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(startMock).toHaveBeenCalledOnce()
		expect(gainNode.gain.value).toBe(0.4)
		sources[0]?.onended?.()
		expect(suspendMock).toHaveBeenCalledOnce()
	})
})
