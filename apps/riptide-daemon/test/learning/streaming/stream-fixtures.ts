import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect } from 'vitest'

// This fixture documents the Claude Agent SDK partial-message protocol we have
// observed so far. When includePartialMessages is enabled, the SDK emits raw
// stream_event items before the completed assistant message. The text deltas are
// not stable chunk boundaries, so tests should accumulate them and compare the
// final accumulated text to the completed assistant content block.
export const createPartialTextStreamFixture = () => {
	const streamEventTypes: string[] = []
	const textDeltasByBlock = new Map<number, string>()
	const assistantTextBlocks: string[] = []
	let sawAssistantMessage = false
	let sawMessageStart = false
	let sawContentBlockStart = false
	let sawContentBlockStop = false
	let sawMessageDelta = false
	let sawMessageStop = false
	let contentBlockDeltaCount = 0

	// Track the position of each item in the iterator to assert the boundary
	// between stream_event items and the completed assistant message.
	const itemTypes: string[] = []
	const itemLog: string[] = []
	let itemPosition = 0
	let contentBlockStartPosition = -1
	const assistantPositions: number[] = []

	return {
		observe(item: SDKMessage) {
			const pos = itemPosition++
			itemTypes.push(item.type)

			if (item.type === 'stream_event') {
				const extra =
					item.event.type === 'content_block_start'
						? ` (${item.event.content_block.type}, index=${item.event.index})`
						: item.event.type === 'content_block_stop'
							? ` (index=${item.event.index})`
							: item.event.type === 'content_block_delta'
								? ` (${item.event.delta.type}, index=${item.event.index})`
								: ''
				itemLog.push(`  [${pos}] stream_event: ${item.event.type}${extra}`)
				if (item.event.type === 'content_block_start') {
					contentBlockStartPosition = pos
				}
			} else if (item.type === 'assistant') {
				const blocks = item.message.content.map((b) => b.type).join(', ')
				itemLog.push(`  [${pos}] assistant: content=[${blocks}]`)
				assistantPositions.push(pos)
			} else {
				itemLog.push(`  [${pos}] ${item.type}`)
			}

			if (item.type === 'stream_event') {
				streamEventTypes.push(item.event.type)

				if (item.event.type === 'message_start') {
					// Expected first event for an assistant response. The SDK starts with an
					// empty assistant message, then streams content blocks into it.
					expect(sawMessageStart).toBe(false)
					expect(sawContentBlockStart).toBe(false)
					expect(contentBlockDeltaCount).toBe(0)
					expect(sawContentBlockStop).toBe(false)
					expect(sawMessageDelta).toBe(false)
					expect(sawMessageStop).toBe(false)

					sawMessageStart = true
					expect(item.event.message.type).toBe('message')
					expect(item.event.message.role).toBe('assistant')
					expect(item.event.message.content).toEqual([])
				}

				if (item.event.type === 'content_block_start') {
					// The first content block starts after message_start. For this learning
					// test we expect a single text block at index 0 with initially empty text.
					expect(sawMessageStart).toBe(true)
					expect(sawContentBlockStart).toBe(false)
					expect(contentBlockDeltaCount).toBe(0)
					expect(sawContentBlockStop).toBe(false)
					expect(sawMessageDelta).toBe(false)
					expect(sawMessageStop).toBe(false)

					sawContentBlockStart = true
					expect(item.event.index).toBe(0)
					expect(item.event.content_block.type).toBe('text')

					if (item.event.content_block.type === 'text') {
						expect(item.event.content_block.text).toBe('')
					}
				}

				if (item.event.type === 'content_block_delta') {
					// Text deltas arrive after content_block_start and before the block is
					// closed. The SDK may split text however it wants, so we only require
					// non-empty text_delta chunks and accumulate them by content block index.
					expect(sawMessageStart).toBe(true)
					expect(sawContentBlockStart).toBe(true)
					expect(sawContentBlockStop).toBe(false)
					expect(sawMessageDelta).toBe(false)
					expect(sawMessageStop).toBe(false)

					contentBlockDeltaCount += 1
					expect(item.event.index).toBe(0)
					expect(item.event.delta.type).toBe('text_delta')

					if (item.event.delta.type === 'text_delta') {
						expect(item.event.delta.text.length).toBeGreaterThan(0)
						textDeltasByBlock.set(
							item.event.index,
							`${textDeltasByBlock.get(item.event.index) ?? ''}${item.event.delta.text}`,
						)
					}
				}

				if (item.event.type === 'content_block_stop') {
					// The content block closes only after at least one delta has arrived.
					expect(sawMessageStart).toBe(true)
					expect(sawContentBlockStart).toBe(true)
					expect(contentBlockDeltaCount).toBeGreaterThan(0)
					expect(sawContentBlockStop).toBe(false)
					expect(sawMessageDelta).toBe(false)
					expect(sawMessageStop).toBe(false)

					sawContentBlockStop = true
					expect(item.event.index).toBe(0)
				}

				if (item.event.type === 'message_delta') {
					// After all content blocks are closed, the SDK emits message-level
					// metadata. For a normal one-turn text response, stop_reason is end_turn.
					expect(sawMessageStart).toBe(true)
					expect(sawContentBlockStart).toBe(true)
					expect(contentBlockDeltaCount).toBeGreaterThan(0)
					expect(sawContentBlockStop).toBe(true)
					expect(sawMessageDelta).toBe(false)
					expect(sawMessageStop).toBe(false)

					sawMessageDelta = true
					expect(item.event.delta.stop_reason).toBe('end_turn')
				}

				if (item.event.type === 'message_stop') {
					// message_stop terminates the raw stream_event sequence for the assistant
					// response and must come after message_delta.
					expect(sawMessageStart).toBe(true)
					expect(sawContentBlockStart).toBe(true)
					expect(contentBlockDeltaCount).toBeGreaterThan(0)
					expect(sawContentBlockStop).toBe(true)
					expect(sawMessageDelta).toBe(true)
					expect(sawMessageStop).toBe(false)

					sawMessageStop = true
				}
			}

			if (item.type === 'assistant') {
				// The completed assistant message should match the text produced by the
				// preceding content_block_delta events. This is the stable assertion:
				// chunk boundaries can vary, but accumulated content should not.
				sawAssistantMessage = true
				expect(item.message.role).toBe('assistant')

				for (const contentBlock of item.message.content) {
					expect(contentBlock.type).toBe('text')

					if (contentBlock.type === 'text') {
						expect(contentBlock.text.length).toBeGreaterThan(0)
						assistantTextBlocks.push(contentBlock.text)
					}
				}
			}
		},

		expectComplete() {
			// Observed sequence for a single text response:
			// message_start -> content_block_start -> content_block_delta(s) ->
			// content_block_stop -> message_delta(end_turn) -> message_stop.
			const firstNonDeltaAfterStart = streamEventTypes.findIndex(
				(type, index) => index > 1 && type !== 'content_block_delta',
			)

			expect(streamEventTypes[0]).toBe('message_start')
			expect(streamEventTypes[1]).toBe('content_block_start')
			expect(firstNonDeltaAfterStart).toBeGreaterThan(2)
			expect(
				streamEventTypes.slice(2, firstNonDeltaAfterStart).every((type) => type === 'content_block_delta'),
			).toBe(true)
			expect(streamEventTypes.slice(firstNonDeltaAfterStart)).toEqual([
				'content_block_stop',
				'message_delta',
				'message_stop',
			])
			expect(sawMessageStart).toBe(true)
			expect(sawContentBlockStart).toBe(true)
			expect(sawContentBlockStop).toBe(true)
			expect(sawMessageDelta).toBe(true)
			expect(sawMessageStop).toBe(true)
			expect(sawAssistantMessage).toBe(true)
			expect(contentBlockDeltaCount).toBeGreaterThan(0)
			expect([...textDeltasByBlock.values()]).toEqual(assistantTextBlocks)

			// Dump the full item-by-item sequence for diagnosis
			console.log('[stream-fixture] text: full item sequence:')
			for (const line of itemLog) {
				console.log(line)
			}

			// The content_block_start MUST arrive before the assistant item that
			// contains the block. This is what the daemon needs for its ID lookup.
			expect(contentBlockStartPosition).toBeGreaterThan(-1)
			const firstAssistantPos = assistantPositions[0]
			expect(firstAssistantPos).toBeDefined()
			console.log(
				`[stream-fixture] text: content_block_start at pos ${contentBlockStartPosition}, ` +
					`first assistant at pos ${firstAssistantPos} → ` +
					`${contentBlockStartPosition < firstAssistantPos! ? 'BEFORE (safe for ID lookup)' : 'AFTER (broken)'}`,
			)
			expect(contentBlockStartPosition).toBeLessThan(firstAssistantPos!)

			// The assistant item arrives BEFORE content_block_stop — this is the
			// SDK's incremental behavior. The daemon doesn't need content_block_stop
			// before the assistant item; it only needs content_block_start.
			let streamEventCounter = 0
			const streamEventTypeAtItemIndex = new Map<number, string>()
			for (let i = 0; i < itemTypes.length; i++) {
				if (itemTypes[i] === 'stream_event') {
					streamEventTypeAtItemIndex.set(i, streamEventTypes[streamEventCounter]!)
					streamEventCounter++
				}
			}
			const contentBlockStopPos = [...streamEventTypeAtItemIndex.entries()].find(
				([, type]) => type === 'content_block_stop',
			)?.[0]
			const messageStopPos = [...streamEventTypeAtItemIndex.entries()].find(
				([, type]) => type === 'message_stop',
			)?.[0]

			console.log(
				`[stream-fixture] text: assistant at pos ${firstAssistantPos}, ` +
					`content_block_stop at pos ${contentBlockStopPos}, ` +
					`message_stop at pos ${messageStopPos}`,
			)
			console.log(
				`[stream-fixture] text: assistant arrives ${firstAssistantPos! < (contentBlockStopPos ?? Infinity) ? 'BEFORE' : 'AFTER'} content_block_stop`,
			)
			console.log(
				`[stream-fixture] text: assistant arrives ${firstAssistantPos! < (messageStopPos ?? Infinity) ? 'BEFORE' : 'AFTER'} message_stop`,
			)
		},
	}
}

// This fixture captures the thinking-enabled protocol observed with explicit
// thinking settings. Thinking is streamed as content block 0 before the visible
// text block: thinking_delta chunks, a signature_delta, then a completed
// non-streaming thinking block in the assistant message before text.
export const createThinkingStreamFixture = () => {
	let sawThinkingBlock = false
	let sawAssistantTextBlock = false
	let sawStreamMessageStart = false
	let sawStreamThinkingStart = false
	let sawStreamThinkingDelta = false
	let sawStreamThinkingSignature = false
	let sawStreamThinkingStop = false
	let sawStreamTextStart = false
	let sawStreamTextDelta = false
	let sawStreamTextStop = false
	let sawStreamMessageDelta = false
	let sawStreamMessageStop = false

	// Track every item type and stream event subtype in iterator order so we can
	// assert exactly where the completed assistant message falls relative to
	// content_block_stop and message_stop stream events.
	const itemTypes: string[] = []
	const streamEventTypes: string[] = []
	// Detailed per-item log: position, item type, and stream event subtype + metadata
	const itemLog: string[] = []
	let itemPosition = 0
	// Track content_block_start positions by block index
	const contentBlockStartByIndex = new Map<number, number>()
	// Track each assistant item: its position and which block types it contains
	const assistantItems: Array<{ pos: number; blockTypes: string[] }> = []

	return {
		observe(item: SDKMessage) {
			const pos = itemPosition++
			itemTypes.push(item.type)

			if (item.type === 'stream_event') {
				const extra =
					item.event.type === 'content_block_start'
						? ` (${item.event.content_block.type}, index=${item.event.index})`
						: item.event.type === 'content_block_stop'
							? ` (index=${item.event.index})`
							: item.event.type === 'content_block_delta'
								? ` (${item.event.delta.type}, index=${item.event.index})`
								: ''
				itemLog.push(`  [${pos}] stream_event: ${item.event.type}${extra}`)
			} else if (item.type === 'assistant') {
				const blocks = item.message.content.map((b) => b.type).join(', ')
				itemLog.push(`  [${pos}] assistant: content=[${blocks}]`)
			} else {
				itemLog.push(`  [${pos}] ${item.type}`)
			}

			if (item.type === 'stream_event') {
				streamEventTypes.push(item.event.type)

				// Track content_block_start positions keyed by block index
				if (item.event.type === 'content_block_start') {
					contentBlockStartByIndex.set(item.event.index, pos)
				}
				// Observed thinking-enabled sequence:
				// message_start -> content_block_start(thinking, index 0) ->
				// content_block_delta(thinking_delta, index 0)+ ->
				// content_block_delta(signature_delta, index 0) -> content_block_stop(index 0) ->
				// content_block_start(text, index 1) -> content_block_delta(text_delta, index 1)+ ->
				// content_block_stop(index 1) -> message_delta(end_turn) -> message_stop.
				if (item.event.type === 'message_start') {
					expect(sawStreamMessageStart).toBe(false)
					expect(sawStreamThinkingStart).toBe(false)
					expect(item.event.message.content).toEqual([])
					sawStreamMessageStart = true
				}

				if (item.event.type === 'content_block_start' && item.event.content_block.type === 'thinking') {
					expect(sawStreamMessageStart).toBe(true)
					expect(sawStreamThinkingStart).toBe(false)
					expect(sawStreamThinkingDelta).toBe(false)
					expect(sawStreamThinkingStop).toBe(false)
					expect(sawStreamTextStart).toBe(false)
					expect(item.event.index).toBe(0)
					expect(item.event.content_block.thinking).toBe('')
					expect(item.event.content_block.signature).toBe('')
					sawStreamThinkingStart = true
				}

				if (item.event.type === 'content_block_delta' && item.event.delta.type === 'thinking_delta') {
					expect(sawStreamThinkingStart).toBe(true)
					expect(sawStreamThinkingSignature).toBe(false)
					expect(sawStreamThinkingStop).toBe(false)
					expect(sawStreamTextStart).toBe(false)
					expect(item.event.index).toBe(0)
					// thinking_delta text may be empty with display:'summarized'
					sawStreamThinkingDelta = true
				}

				if (item.event.type === 'content_block_delta' && item.event.delta.type === 'signature_delta') {
					expect(sawStreamThinkingDelta).toBe(true)
					expect(sawStreamThinkingSignature).toBe(false)
					expect(sawStreamThinkingStop).toBe(false)
					expect(sawStreamTextStart).toBe(false)
					expect(item.event.index).toBe(0)
					expect(item.event.delta.signature.length).toBeGreaterThan(0)
					sawStreamThinkingSignature = true
				}

				if (item.event.type === 'content_block_stop' && item.event.index === 0) {
					expect(sawStreamThinkingDelta).toBe(true)
					expect(sawStreamThinkingSignature).toBe(true)
					expect(sawStreamThinkingStop).toBe(false)
					expect(sawStreamTextStart).toBe(false)
					sawStreamThinkingStop = true
				}

				if (item.event.type === 'content_block_start' && item.event.content_block.type === 'text') {
					expect(sawStreamThinkingStop).toBe(true)
					expect(sawStreamTextStart).toBe(false)
					expect(sawStreamTextDelta).toBe(false)
					expect(item.event.index).toBe(1)
					expect(item.event.content_block.text).toBe('')
					sawStreamTextStart = true
				}

				if (item.event.type === 'content_block_delta' && item.event.delta.type === 'text_delta') {
					expect(sawStreamTextStart).toBe(true)
					expect(sawStreamTextStop).toBe(false)
					expect(item.event.index).toBe(1)
					expect(item.event.delta.text.length).toBeGreaterThan(0)
					sawStreamTextDelta = true
				}

				if (item.event.type === 'content_block_stop' && item.event.index === 1) {
					expect(sawStreamTextDelta).toBe(true)
					expect(sawStreamTextStop).toBe(false)
					sawStreamTextStop = true
				}

				if (item.event.type === 'message_delta') {
					expect(sawStreamTextStop).toBe(true)
					expect(sawStreamMessageDelta).toBe(false)
					expect(item.event.delta.stop_reason).toBe('end_turn')
					sawStreamMessageDelta = true
				}

				if (item.event.type === 'message_stop') {
					expect(sawStreamMessageDelta).toBe(true)
					expect(sawStreamMessageStop).toBe(false)
					sawStreamMessageStop = true
				}
			}

			if (item.type === 'assistant') {
				const blockTypes = item.message.content.map((b) => b.type)
				assistantItems.push({ pos, blockTypes })

				for (const contentBlock of item.message.content) {
					if (contentBlock.type === 'thinking') {
						expect(contentBlock.thinking.length).toBeGreaterThan(0)
						sawThinkingBlock = true
					}

					if (contentBlock.type === 'text') {
						sawAssistantTextBlock = true
					}
				}
			}
		},

		expectComplete() {
			expect(sawThinkingBlock).toBe(true)
			expect(sawAssistantTextBlock).toBe(true)
			expect(sawStreamMessageStart).toBe(true)
			expect(sawStreamThinkingStart).toBe(true)
			expect(sawStreamThinkingDelta).toBe(true)
			expect(sawStreamThinkingSignature).toBe(true)
			expect(sawStreamThinkingStop).toBe(true)
			expect(sawStreamTextStart).toBe(true)
			expect(sawStreamTextDelta).toBe(true)
			expect(sawStreamTextStop).toBe(true)
			expect(sawStreamMessageDelta).toBe(true)
			expect(sawStreamMessageStop).toBe(true)

			// Dump the full item-by-item sequence for diagnosis
			console.log('[stream-fixture] thinking: full item sequence:')
			for (const line of itemLog) {
				console.log(line)
			}

			// KEY DISCOVERY: The SDK yields multiple incremental `assistant` items
			// per API response — one after each content block completes — NOT a
			// single `assistant` item at the end with all blocks.
			console.log('[stream-fixture] thinking: assistant items:', assistantItems)
			console.log('[stream-fixture] thinking: content_block_start positions by index:', [
				...contentBlockStartByIndex.entries(),
			])

			// Verify the SDK yields multiple assistant items (incremental)
			expect(assistantItems.length).toBeGreaterThanOrEqual(2)

			// The critical question: does each content_block_start arrive BEFORE
			// the assistant item that contains the corresponding block type?
			// This is what actually matters for the daemon's ID lookup.
			for (const [blockIndex, startPos] of contentBlockStartByIndex.entries()) {
				const blockType = blockIndex === 0 ? 'thinking' : 'text'
				// Find the first assistant item that contains this block type
				const matchingAssistant = assistantItems.find((a) => a.blockTypes.includes(blockType))
				if (!matchingAssistant) {
					throw new Error(`No assistant item found containing block type '${blockType}'`)
				}
				console.log(
					`[stream-fixture] thinking: content_block_start(${blockType}, index=${blockIndex}) at pos ${startPos}, ` +
						`first assistant with '${blockType}' at pos ${matchingAssistant.pos} → ` +
						`${startPos < matchingAssistant.pos ? 'BEFORE (safe)' : 'AFTER (broken)'}`,
				)
				expect(startPos).toBeLessThan(matchingAssistant.pos)
			}

			// Also verify: does each assistant item arrive BEFORE or AFTER the
			// content_block_stop and message_stop for its blocks? The daemon reads
			// from its ID maps in handleMessage — if the assistant item arrives
			// after content_block_start but before content_block_stop, the ID map
			// IS populated (safe). Log this for clarity.
			for (const assistant of assistantItems) {
				console.log(
					`[stream-fixture] thinking: assistant at pos ${assistant.pos} contains blocks: [${assistant.blockTypes.join(', ')}]`,
				)
			}
		},
	}
}
