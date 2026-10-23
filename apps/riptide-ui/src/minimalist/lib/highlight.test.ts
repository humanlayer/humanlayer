import type { Element, Root } from 'hast'
import { describe, expect, it } from 'vitest'

import { highlightCode } from '@/minimalist/lib/highlight'

const block = (language: string | null, text: string): Root => ({
	type: 'root',
	children: [
		{
			type: 'element',
			tagName: 'pre',
			properties: {},
			children: [
				{
					type: 'element',
					tagName: 'code',
					properties: language ? { className: [`language-${language}`] } : {},
					children: [{ type: 'text', value: text }],
				},
			],
		},
	],
})

const code = (tree: Root) => ((tree.children[0] as Element).children[0] as Element).children

describe('highlightCode', () => {
	it('colors code in a named language', () => {
		const tree = block('ts', 'const x = 1')
		highlightCode()(tree)
		expect(code(tree).some((node) => node.type === 'element')).toBe(true)
	})

	it('leaves unnamed, unknown and mermaid code as plain text', () => {
		for (const language of [null, 'not-a-language', 'mermaid']) {
			const tree = block(language, 'flowchart LR')
			highlightCode()(tree)
			expect(code(tree)).toEqual([{ type: 'text', value: 'flowchart LR' }])
		}
	})
})
