import { describe, expect, it } from 'vitest'
import { parseMcpTextContent } from './formatters'

describe('parseMcpTextContent', () => {
	it('should extract text from single text block', () => {
		const content = '[{"type":"text","text":"Hello World"}]'
		expect(parseMcpTextContent(content)).toBe('Hello World')
	})

	it('should join multiple text blocks with newlines', () => {
		const content = '[{"type":"text","text":"First block"},{"type":"text","text":"Second block"}]'
		expect(parseMcpTextContent(content)).toBe('First block\nSecond block')
	})

	it('should preserve newlines within text content', () => {
		const content = '[{"type":"text","text":"Line 1\\nLine 2\\nLine 3"}]'
		expect(parseMcpTextContent(content)).toBe('Line 1\nLine 2\nLine 3')
	})

	it('should show placeholder for image content', () => {
		const content = '[{"type":"image","data":"base64..."}]'
		expect(parseMcpTextContent(content)).toBe('[image content]')
	})

	it('should show placeholder for resource content', () => {
		const content = '[{"type":"resource","uri":"file://..."}]'
		expect(parseMcpTextContent(content)).toBe('[resource content]')
	})

	it('should show generic placeholder for unknown types', () => {
		const content = '[{"type":"binary","data":"..."}]'
		expect(parseMcpTextContent(content)).toBe('[binary content]')
	})

	it('should handle mixed content types', () => {
		const content = '[{"type":"text","text":"Before image"},{"type":"image","data":"..."},{"type":"text","text":"After image"}]'
		expect(parseMcpTextContent(content)).toBe('Before image\n[image content]\nAfter image')
	})

	it('should return original content when JSON is invalid', () => {
		const content = 'This is not JSON'
		expect(parseMcpTextContent(content)).toBe('This is not JSON')
	})

	it('should return original content when not an array', () => {
		const content = '{"type":"text","text":"Not in array"}'
		expect(parseMcpTextContent(content)).toBe('{"type":"text","text":"Not in array"}')
	})

	it('should return undefined for undefined input', () => {
		expect(parseMcpTextContent(undefined)).toBeUndefined()
	})

	it('should return undefined for empty string', () => {
		// Empty string is falsy, so returns undefined
		expect(parseMcpTextContent('')).toBeUndefined()
	})

	it('should return original content for empty array', () => {
		const content = '[]'
		expect(parseMcpTextContent(content)).toBe('[]')
	})

	it('should skip blocks without type field', () => {
		const content = '[{"text":"No type field"},{"type":"text","text":"Has type"}]'
		expect(parseMcpTextContent(content)).toBe('Has type')
	})

	it('should skip text blocks with empty text', () => {
		const content = '[{"type":"text","text":""},{"type":"text","text":"Not empty"}]'
		expect(parseMcpTextContent(content)).toBe('Not empty')
	})

	it('should handle real MCP response format', () => {
		const content = '[{"type":"text","text":"Available Libraries:\\n\\n- Title: Zod\\n- ID: /colinhacks/zod\\n- Description: TypeScript-first schema validation"}]'
		const result = parseMcpTextContent(content)
		expect(result).toContain('Available Libraries:')
		expect(result).toContain('Zod')
	})
})
