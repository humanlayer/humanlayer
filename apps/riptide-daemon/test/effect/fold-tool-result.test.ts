import { describe, expect, it } from 'vitest'

import { renderFoldToolResult } from '@/effects/services/fold-sessions/fold-tool-result'

describe('renderFoldToolResult', () => {
	it('renders canonical text and failure results without JSON envelopes', () => {
		expect(renderFoldToolResult({ _tag: 'text', text: 'plain output\n' })).toBe('plain output\n')
		expect(renderFoldToolResult({ _tag: 'failure', text: 'command failed' })).toBe('command failed')
	})

	it('renders ordered text from canonical multipart results without persisting image data', () => {
		expect(
			renderFoldToolResult({
				_tag: 'multipart',
				content: [
					{ _tag: 'text-part', text: 'Read image file [image/png]' },
					{ _tag: 'image-part', mediaType: 'image/png', data: 'base64-image-data' },
					{ _tag: 'text-part', text: 'done' },
				],
			}),
		).toBe('Read image file [image/png]\ndone')
	})

	it('supports durable results written by earlier Fold releases', () => {
		expect(renderFoldToolResult({ output: '\u001b[31mred\u001b[0m\n' })).toBe('\u001b[31mred\u001b[0m\n')
		expect(renderFoldToolResult({ message: 'write complete' })).toBe('write complete')
		expect(renderFoldToolResult({ content: 'subagent result' })).toBe('subagent result')
		expect(renderFoldToolResult({ content: [{ type: 'text', text: 'read result' }] })).toBe('read result')
	})

	it('retains JSON fallback for unknown custom results', () => {
		expect(renderFoldToolResult({ custom: true })).toBe('{"custom":true}')
	})
})
