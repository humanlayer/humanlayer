import { describe, expect, it } from 'vitest'

import {
	ARTIFACT_TRACE_AFTER_MARK_MS,
	createArtifactSidePanelTraceSession,
	redactArtifactTraceData,
} from './artifact-side-panel-trace'

describe('artifact side-panel trace session', () => {
	it('keeps bounded pre/post-mark events and redacts authored data', () => {
		let now = 0
		const trace = createArtifactSidePanelTraceSession({ now: () => now, eventCap: 3 })
		for (let index = 0; index < 5; index++) {
			now = index * 10_000
			trace.record('event', { index, content: `secret-${index}` })
		}

		trace.mark()
		now += ARTIFACT_TRACE_AFTER_MARK_MS
		trace.record('at-end', {
			commentId: 'comment-1',
			hasBlockTarget: true,
			width: 480,
		})
		now += 1
		trace.record('too-late')

		const events = trace.exportTrace().events
		expect(events.map((event) => event.type)).toEqual(['event', 'mark', 'at-end'])
		expect(events[0]?.data).toEqual({ index: 4, content: '[redacted]' })
		expect(events[2]?.data).toEqual({
			commentId: '[redacted]',
			hasBlockTarget: true,
			width: 480,
		})
		expect(trace.status().eventCount).toBe(3)
		expect(redactArtifactTraceData({ nested: {}, instanceId: 'viewer-1' })).toEqual({
			instanceId: 'viewer-1',
		})
	})
})
