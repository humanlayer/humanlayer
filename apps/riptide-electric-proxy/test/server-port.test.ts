import { describe, expect, it } from 'vitest'

import { resolveElectricProxyPort } from '../src/server-port'

describe('resolveElectricProxyPort', () => {
	it('prefers the stack-specific proxy port', () => {
		expect(resolveElectricProxyPort({ RIPTIDE_ELECTRIC_PROXY_PORT: '4567', PORT: '1234' })).toBe(4567)
	})

	it('falls back to PORT and then the default', () => {
		expect(resolveElectricProxyPort({ PORT: '1234' })).toBe(1234)
		expect(resolveElectricProxyPort({})).toBe(8888)
	})
})
