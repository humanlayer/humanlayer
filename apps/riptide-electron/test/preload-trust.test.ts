import { describe, expect, it } from 'vitest'

import { isTrustedRenderer } from '../src/preload-trust'

describe('Electron preload trust', () => {
	it('accepts the packaged custom-scheme renderer', () => {
		expect(
			isTrustedRenderer({
				location: {
					protocol: 'humanlayer-electron-dev:',
					host: 'app',
					pathname: '/',
				},
				rendererUrl: 'humanlayer-electron-dev://app/',
			}),
		).toBe(true)
	})

	it('rejects custom-scheme URLs with a different host', () => {
		expect(
			isTrustedRenderer({
				location: {
					protocol: 'humanlayer-electron-dev:',
					host: 'untrusted',
					pathname: '/',
				},
				rendererUrl: 'humanlayer-electron-dev://app/',
			}),
		).toBe(false)
	})
})
