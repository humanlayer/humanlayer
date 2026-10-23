import { describe, expect, it } from 'vitest'

import type { SelectionIntent } from './selection'
import { idleReviewTarget, transitionReviewTarget, type ReviewTargetState } from './review-target'

const intent = (from: number, to: number): SelectionIntent => ({
	from,
	to,
	quote: `${from}-${to}`,
	rect: null,
	anchor: {
		v: 2,
		scope: 'range',
		selectedText: `${from}-${to}`,
		start: { blockType: 'paragraph', blockText: 'text', previousBlockText: null, nextBlockText: null, offset: 0 },
		end: { blockType: 'paragraph', blockText: 'text', previousBlockText: null, nextBlockText: null, offset: 1 },
	},
})

const block = (id: string, pos: number, end: number) => ({ id, pos, end })

describe('review target transitions', () => {
	it('replaces a block target with a precise target', () => {
		const first = transitionReviewTarget(idleReviewTarget(), { type: 'accept-block', block: block('a', 1, 8) })
		const next = transitionReviewTarget(first.state, {
			type: 'accept-selection',
			result: { status: 'selection', intent: intent(3, 5) },
		})
		expect(next.state).toMatchObject({ phase: 'pending', target: { kind: 'range', owner: 'mouse' } })
		expect(next.decoration).toEqual({ kind: 'range', from: 3, to: 5 })
	})

	it('keeps browser keyboard selections distinct from mouse ranges', () => {
		const next = transitionReviewTarget(idleReviewTarget(), {
			type: 'accept-selection',
			result: { status: 'selection', intent: intent(3, 5) },
			source: 'keyboard',
		})

		expect(next.state).toMatchObject({ phase: 'pending', target: { kind: 'range', owner: 'browser-keyboard' } })
		expect(next.decoration).toEqual({ kind: 'range', from: 3, to: 5 })
	})

	it('keeps a keyboard-owned target when browser selection becomes empty', () => {
		const keyboard = transitionReviewTarget(idleReviewTarget(), {
			type: 'accept-keyboard',
			result: { status: 'valid', keyboard: { anchorId: 'a', headId: 'b' }, intent: intent(1, 9) },
		})
		const next = transitionReviewTarget(keyboard.state, { type: 'accept-selection', result: { status: 'empty' } })
		expect(next.state).toBe(keyboard.state)
		expect(next.decoration).toEqual({ kind: 'keep' })
	})

	it('does not create or retain state for an invalid keyboard outcome', () => {
		const pending = transitionReviewTarget(idleReviewTarget(), { type: 'accept-block', block: block('a', 1, 8) })
		const next = transitionReviewTarget(pending.state, {
			type: 'accept-keyboard',
			result: { status: 'invalid' },
		})
		expect(next.state).toEqual({ phase: 'idle' })
		expect(next.decoration).toEqual({ kind: 'clear' })
	})

	it('opens a block composer directly and installs its decoration', () => {
		const next = transitionReviewTarget(idleReviewTarget(), {
			type: 'open-composer',
			fallbackBlock: block('a', 1, 8),
		})
		expect(next.state).toEqual({
			phase: 'composing',
			target: { kind: 'block', blockId: 'a', from: 1, to: 8 },
		})
		expect(next.decoration).toEqual({ kind: 'range', from: 1, to: 8 })
	})

	it('soft-closes a composer while retaining the same target and decoration', () => {
		const composing = transitionReviewTarget(idleReviewTarget(), {
			type: 'open-composer',
			fallbackBlock: block('a', 1, 8),
		})
		expect(composing.state.phase).toBe('composing')
		if (composing.state.phase !== 'composing') throw new Error('expected composing target')

		const closed = transitionReviewTarget(composing.state, { type: 'close-composer' })
		expect(closed.state).toEqual({ phase: 'pending', target: composing.state.target })
		if (closed.state.phase !== 'pending') throw new Error('expected pending target')
		expect(closed.state.target).toBe(composing.state.target)
		expect(closed.decoration).toEqual({ kind: 'keep' })
		expect(closed.consumed).toBe(true)
	})

	it.each([
		['idle', idleReviewTarget()],
		['pending', transitionReviewTarget(idleReviewTarget(), { type: 'accept-block', block: block('a', 1, 8) }).state],
	])('does not close a composer from %s', (_phase, state) => {
		const next = transitionReviewTarget(state, { type: 'close-composer' })
		expect(next.state).toBe(state)
		expect(next.decoration).toEqual({ kind: 'keep' })
		expect(next.consumed).toBe(false)
	})

	it('fully dismisses or submits a composing target', () => {
		const pending = transitionReviewTarget(idleReviewTarget(), { type: 'accept-block', block: block('a', 1, 8) })
		const composing = transitionReviewTarget(pending.state, { type: 'open-composer' })
		expect(composing.state).toMatchObject({ phase: 'composing', target: { kind: 'block', blockId: 'a' } })
		expect(transitionReviewTarget(composing.state, { type: 'dismiss' })).toMatchObject({
			state: { phase: 'idle' },
			decoration: { kind: 'clear' },
			consumed: true,
		})
		expect(transitionReviewTarget(composing.state, { type: 'submitted' }).state).toEqual({ phase: 'idle' })
	})

	it('represents Escape precedence as a consumed dismiss outcome', () => {
		const pending = transitionReviewTarget(idleReviewTarget(), { type: 'accept-block', block: block('a', 1, 8) })
		expect(transitionReviewTarget(pending.state, { type: 'dismiss' }).consumed).toBe(true)
		expect(transitionReviewTarget(idleReviewTarget(), { type: 'dismiss' }).consumed).toBe(false)
	})

	it.each([
		['block', transitionReviewTarget(idleReviewTarget(), { type: 'accept-block', block: block('hidden', 4, 8) }).state],
		[
			'range',
			transitionReviewTarget(idleReviewTarget(), {
				type: 'accept-selection',
				result: { status: 'selection', intent: intent(5, 12) },
			}).state,
		],
	])('invalidates a hidden %s target for every fold entry point', (_kind, state: ReviewTargetState) => {
		const next = transitionReviewTarget(state, {
			type: 'fold',
			hiddenBlockIds: new Set(['hidden']),
			hiddenRanges: [{ from: 3, to: 10 }],
		})
		expect(next.state).toEqual({ phase: 'idle' })
		expect(next.decoration).toEqual({ kind: 'clear' })
	})

	it('submits a verdict for the pending block target and clears it', () => {
		const pending = transitionReviewTarget(idleReviewTarget(), { type: 'accept-block', block: block('a', 1, 8) })
		const next = transitionReviewTarget(pending.state, { type: 'submit-verdict', kind: 'deletion' })
		expect(next.submit).toEqual({ target: { kind: 'block', blockId: 'a', from: 1, to: 8 }, kind: 'deletion' })
		expect(next.state).toEqual({ phase: 'idle' })
		expect(next.decoration).toEqual({ kind: 'clear' })
	})

	it('prefers a retained block target over a different fallback block', () => {
		const pending = transitionReviewTarget(idleReviewTarget(), { type: 'accept-block', block: block('a', 1, 8) })
		const next = transitionReviewTarget(pending.state, {
			type: 'submit-verdict',
			kind: 'deletion',
			fallbackBlock: block('b', 20, 30),
		})
		expect(next.submit).toEqual({ target: { kind: 'block', blockId: 'a', from: 1, to: 8 }, kind: 'deletion' })
		expect(next.state).toEqual({ phase: 'idle' })
		expect(next.decoration).toEqual({ kind: 'clear' })
	})

	it('submits a verdict from the exact composing target', () => {
		const composing = transitionReviewTarget(idleReviewTarget(), {
			type: 'open-composer',
			fallbackBlock: block('a', 1, 8),
		})
		const next = transitionReviewTarget(composing.state, {
			type: 'submit-verdict',
			kind: 'approval',
			fallbackBlock: block('b', 20, 30),
		})
		expect(next.submit).toEqual({ target: { kind: 'block', blockId: 'a', from: 1, to: 8 }, kind: 'approval' })
		expect(next.state).toEqual({ phase: 'idle' })
		expect(next.decoration).toEqual({ kind: 'clear' })
	})

	it('keeps a pending range target ahead of the focused block', () => {
		// A deliberate precise/multi-block selection wins even when a block is also
		// focused (the keyboard-range head is the focused block).
		const pending = transitionReviewTarget(idleReviewTarget(), {
			type: 'accept-selection',
			result: { status: 'selection', intent: intent(4, 9) },
		})
		const next = transitionReviewTarget(pending.state, {
			type: 'submit-verdict',
			kind: 'deletion',
			fallbackBlock: block('focused', 20, 30),
		})
		expect(next.submit?.target).toMatchObject({ kind: 'range', owner: 'mouse' })
	})

	it('submits a verdict for the pending precise range target', () => {
		const pending = transitionReviewTarget(idleReviewTarget(), {
			type: 'accept-selection',
			result: { status: 'selection', intent: intent(4, 9) },
		})
		const next = transitionReviewTarget(pending.state, { type: 'submit-verdict', kind: 'approval' })
		expect(next.submit?.kind).toBe('approval')
		expect(next.submit?.target).toMatchObject({ kind: 'range', owner: 'mouse' })
		expect(next.state).toEqual({ phase: 'idle' })
	})

	it('falls back to the focused block when no target is pending', () => {
		const next = transitionReviewTarget(idleReviewTarget(), {
			type: 'submit-verdict',
			kind: 'deletion',
			fallbackBlock: block('focused', 12, 20),
		})
		expect(next.submit).toEqual({
			target: { kind: 'block', blockId: 'focused', from: 12, to: 20 },
			kind: 'deletion',
		})
		expect(next.state).toEqual({ phase: 'idle' })
	})

	it('is a no-op verdict without a pending target or fallback block', () => {
		const next = transitionReviewTarget(idleReviewTarget(), { type: 'submit-verdict', kind: 'approval' })
		expect(next.submit).toBeUndefined()
		expect(next.state).toEqual({ phase: 'idle' })
		expect(next.decoration).toEqual({ kind: 'keep' })
	})

	it('replaces targets repeatedly without leaking prior ownership', () => {
		const precise = transitionReviewTarget(idleReviewTarget(), {
			type: 'accept-selection',
			result: { status: 'selection', intent: intent(2, 4) },
		})
		const keyboard = transitionReviewTarget(precise.state, {
			type: 'accept-keyboard',
			result: { status: 'valid', keyboard: { anchorId: 'b', headId: 'c' }, intent: intent(8, 15) },
		})
		const next = transitionReviewTarget(keyboard.state, { type: 'accept-block', block: block('d', 20, 30) })
		expect(next.state).toEqual({
			phase: 'pending',
			target: { kind: 'block', blockId: 'd', from: 20, to: 30 },
		})
	})
})
