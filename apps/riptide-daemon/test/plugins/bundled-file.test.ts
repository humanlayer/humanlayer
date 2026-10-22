import { describe, expect, it } from 'vitest'

import { parseBundledFilePath, parseBundledPluginManifest } from '../../src/plugins/bundled-file'

describe('bundled file parsers', () => {
	it('accepts Bun file import paths and plugin manifest versions', () => {
		expect(parseBundledFilePath('/tmp/plugin.json')).toBe('/tmp/plugin.json')
		expect(parseBundledPluginManifest({ version: '1.2.3' })).toEqual({ version: '1.2.3' })
	})

	it('rejects invalid bundled file paths and plugin manifests', () => {
		expect(() => parseBundledFilePath({ path: '/tmp/plugin.json' })).toThrow()
		expect(() => parseBundledPluginManifest({ version: '' })).toThrow()
		expect(() => parseBundledPluginManifest({})).toThrow()
	})
})
