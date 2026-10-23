import { describe, expect, test } from 'vitest'
import { type CommentAnchor, type MatchableBlock, matchCommentToBlock } from './comment-matching'

function block(text: string, opts?: Partial<MatchableBlock>): MatchableBlock {
	return { pos: 0, text, nodeType: 'paragraph', nodeSize: text.length + 2, ...opts }
}

function anchor(opts: Partial<CommentAnchor> & { commentedUponBlockText: string | null }): CommentAnchor {
	return {
		commentedUponBlockText: opts.commentedUponBlockText,
		previousBlockText: opts.previousBlockText ?? null,
		nextBlockText: opts.nextBlockText ?? null,
	}
}

describe('matchCommentToBlock', () => {
	test('exact text match returns the block index', () => {
		const blocks = [block('Intro paragraph'), block('The commented block'), block('Closing paragraph')]
		const idx = matchCommentToBlock(blocks, anchor({ commentedUponBlockText: 'The commented block' }))
		expect(idx).toBe(1)
	})

	test('prev/next context disambiguates duplicate text', () => {
		const blocks = [
			block('Above one'),
			block('Same text'),
			block('Below one'),
			block('Above two'),
			block('Same text'),
			block('Below two'),
		]
		const idx = matchCommentToBlock(
			blocks,
			anchor({
				commentedUponBlockText: 'Same text',
				previousBlockText: 'Above two',
				nextBlockText: 'Below two',
			}),
		)
		expect(idx).toBe(4)
	})

	test('higher context score wins on tie-break', () => {
		const blocks = [
			// First "Same text": only prev context matches (score 3)
			block('Above'),
			block('Same text'),
			block('Wrong below'),
			// Second "Same text": both prev and next match (score 5)
			block('Above'),
			block('Same text'),
			block('Below'),
		]
		const idx = matchCommentToBlock(
			blocks,
			anchor({ commentedUponBlockText: 'Same text', previousBlockText: 'Above', nextBlockText: 'Below' }),
		)
		expect(idx).toBe(4)
	})

	test('first block: null previous context scores', () => {
		const blocks = [block('First block'), block('Second block')]
		const idx = matchCommentToBlock(
			blocks,
			anchor({ commentedUponBlockText: 'First block', previousBlockText: null, nextBlockText: 'Second block' }),
		)
		expect(idx).toBe(0)
	})

	test('last block: null next context scores', () => {
		const blocks = [block('First block'), block('Last block')]
		const idx = matchCommentToBlock(
			blocks,
			anchor({ commentedUponBlockText: 'Last block', previousBlockText: 'First block', nextBlockText: null }),
		)
		expect(idx).toBe(1)
	})

	test('no matching text returns -1', () => {
		const blocks = [block('One'), block('Two')]
		const idx = matchCommentToBlock(blocks, anchor({ commentedUponBlockText: 'Nonexistent' }))
		expect(idx).toBe(-1)
	})

	test('null commented-upon text returns -1', () => {
		const blocks = [block('One')]
		const idx = matchCommentToBlock(blocks, anchor({ commentedUponBlockText: null }))
		expect(idx).toBe(-1)
	})

	test('empty blocks array returns -1', () => {
		const idx = matchCommentToBlock([], anchor({ commentedUponBlockText: 'anything' }))
		expect(idx).toBe(-1)
	})

	test('trim normalization: stored trimmed anchor matches whitespace-padded live block', () => {
		const blocks = [block('  Padded block text  '), block('Other')]
		const idx = matchCommentToBlock(blocks, anchor({ commentedUponBlockText: 'Padded block text' }))
		expect(idx).toBe(0)
	})

	test('trim normalization applies to prev/next context too', () => {
		const blocks = [block('  Above  '), block('Target'), block('\tBelow\n')]
		const idx = matchCommentToBlock(
			blocks,
			anchor({ commentedUponBlockText: 'Target', previousBlockText: 'Above', nextBlockText: 'Below' }),
		)
		expect(idx).toBe(1)
	})

	test('whitespace-only live block normalizes to null context (matches stored null)', () => {
		// First block has whitespace-only "previous" — should compare equal to stored null.
		const blocks = [block('   '), block('Target'), block('After')]
		const idx = matchCommentToBlock(
			blocks,
			anchor({ commentedUponBlockText: 'Target', previousBlockText: null, nextBlockText: 'After' }),
		)
		expect(idx).toBe(1)
	})
})
