import { afterEach, describe, expect, it } from 'vitest'

import { isDesktop, isElectron, isTauri } from './utils'

afterEach(() => {
	delete (window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__
	delete (window as Window & { __TAURI__?: unknown }).__TAURI__
})

describe('desktop runtime detection', () => {
	it('recognizes Tauri as desktop', () => {
		;(window as Window & { __TAURI__?: unknown }).__TAURI__ = {}

		expect(isTauri()).toBe(true)
		expect(isElectron()).toBe(false)
		expect(isDesktop()).toBe(true)
	})

	it('recognizes Electron as desktop', () => {
		;(window as Window & { __RIPTIDE_ELECTRON__?: unknown }).__RIPTIDE_ELECTRON__ = {}

		expect(isTauri()).toBe(false)
		expect(isElectron()).toBe(true)
		expect(isDesktop()).toBe(true)
	})

	it('keeps browser clients out of desktop-only features', () => {
		expect(isTauri()).toBe(false)
		expect(isElectron()).toBe(false)
		expect(isDesktop()).toBe(false)
	})
})
