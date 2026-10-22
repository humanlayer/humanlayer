import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	isNative: true,
	saveArtifactTrace: vi.fn(),
}))

vi.mock('@/integrations/tauri/artifact-trace', () => ({ saveArtifactTrace: mocks.saveArtifactTrace }))
vi.mock('@/lib/utils', () => ({ isTauri: () => mocks.isNative }))
vi.mock('sonner', () => ({
	toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))

import { artifactSidePanelTrace, setArtifactTraceEnabled } from './artifact-side-panel-trace'

describe('artifact side-panel trace runtime', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		mocks.saveArtifactTrace.mockReset()
		vi.stubGlobal(
			'MutationObserver',
			class {
				observe() {}
				disconnect() {}
			},
		)
		setArtifactTraceEnabled(false)
		artifactSidePanelTrace.clear()
		setArtifactTraceEnabled(true)
	})

	afterEach(() => {
		setArtifactTraceEnabled(false)
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it('delays native saves and lets only the latest mark completion win', async () => {
		const completions: Array<(path: string) => void> = []
		mocks.saveArtifactTrace.mockImplementation(() => new Promise<string>((resolve) => completions.push(resolve)))

		expect(artifactSidePanelTrace.mark()).toBe(true)
		await vi.advanceTimersByTimeAsync(4_999)
		expect(mocks.saveArtifactTrace).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(mocks.saveArtifactTrace).toHaveBeenCalledOnce()
		expect(JSON.parse(mocks.saveArtifactTrace.mock.calls[0]![0])).toMatchObject({ version: 1 })

		expect(artifactSidePanelTrace.mark()).toBe(true)
		completions[0]!('/tmp/stale.json')
		await Promise.resolve()
		expect(artifactSidePanelTrace.status().output.phase).toBe('capturing')
		await vi.advanceTimersByTimeAsync(4_999)
		expect(mocks.saveArtifactTrace).toHaveBeenCalledOnce()
		await vi.advanceTimersByTimeAsync(1)
		expect(mocks.saveArtifactTrace).toHaveBeenCalledTimes(2)

		completions[1]!('/tmp/latest.json')
		await Promise.resolve()
		expect(artifactSidePanelTrace.status().output).toEqual({
			phase: 'saved',
			savedPath: '/tmp/latest.json',
			error: null,
		})
	})
})
