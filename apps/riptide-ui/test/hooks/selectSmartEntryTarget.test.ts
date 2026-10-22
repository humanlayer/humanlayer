import { describe, expect, it } from 'vitest'

import { selectSmartEntryTarget } from '@/hooks/selectSmartEntryTarget'

type EventLike = { id: string; parentToolUseId: string | undefined }

describe('selectSmartEntryTarget', () => {
	it('returns {kind:"bottom"} when there is no pending approval', () => {
		const events: EventLike[] = [
			{ id: 'e1', parentToolUseId: undefined },
			{ id: 'e2', parentToolUseId: undefined },
		]
		expect(selectSmartEntryTarget(null, events)).toEqual({ kind: 'bottom' })
	})

	it('returns {kind:"pending-approval", parentToolUseId:undefined} for a root-level approval', () => {
		const events: EventLike[] = [
			{ id: 'e1', parentToolUseId: undefined },
			{ id: 'approval-1', parentToolUseId: undefined },
		]
		expect(selectSmartEntryTarget('approval-1', events)).toEqual({
			kind: 'pending-approval',
			eventId: 'approval-1',
			parentToolUseId: undefined,
		})
	})

	it('returns {kind:"pending-approval", parentToolUseId:<parent>} for a nested approval', () => {
		const events: EventLike[] = [
			{ id: 'parent-task-1', parentToolUseId: undefined },
			{ id: 'approval-1', parentToolUseId: 'parent-tool-use-1' },
		]
		expect(selectSmartEntryTarget('approval-1', events)).toEqual({
			kind: 'pending-approval',
			eventId: 'approval-1',
			parentToolUseId: 'parent-tool-use-1',
		})
	})

	it('returns {kind:"bottom"} when the pending-approval id is not present in events (live-query lag)', () => {
		const events: EventLike[] = [
			{ id: 'e1', parentToolUseId: undefined },
			{ id: 'e2', parentToolUseId: undefined },
		]
		expect(selectSmartEntryTarget('approval-missing', events)).toEqual({ kind: 'bottom' })
	})

	it('returns {kind:"bottom"} when events is empty even with a non-null pending id', () => {
		expect(selectSmartEntryTarget('approval-1', [])).toEqual({ kind: 'bottom' })
	})
})
