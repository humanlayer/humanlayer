import * as jestDomMatchers from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'
import { afterEach, expect } from 'vitest'

// jest-dom's vitest entry imports whichever vitest copy the linker hoisted, which can differ from this
// package's; a second copy breaks `.rejects`. Register the matchers on this package's expect instead.
expect.extend(jestDomMatchers)

const storage = new Map<string, string>()
const testStorage: Storage = {
	get length() {
		return storage.size
	},
	clear: () => storage.clear(),
	getItem: (key) => storage.get(key) ?? null,
	key: (index) => Array.from(storage.keys())[index] ?? null,
	removeItem: (key) => storage.delete(key),
	setItem: (key, value) => storage.set(key, String(value)),
}

Object.defineProperty(globalThis, 'localStorage', {
	configurable: true,
	value: testStorage,
})

Object.defineProperty(window, 'localStorage', {
	configurable: true,
	value: testStorage,
})

afterEach(() => {
	cleanup()
	storage.clear()
})
