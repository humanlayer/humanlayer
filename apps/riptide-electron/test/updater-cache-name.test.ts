import { createRequire } from 'node:module'

import { describe, expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const { appUpdateManifestForProductName } = require('../scripts/set-updater-cache-name.cjs') as {
	appUpdateManifestForProductName: (productName: string) => string
}

describe('Electron updater manifest', () => {
	test.each([
		['HumanLayerElectron', 'https://update.humanlayer.com/stable', 'humanlayer-electron-updater'],
		['HumanLayerElectronBeta', 'https://update.codelayer.cloud/beta', 'humanlayer-electron-beta-updater'],
		['HumanLayerElectronDev', 'https://update.dev.codelayer.gg/dev', 'humanlayer-electron-dev-updater'],
		['HumanLayerElectronLocal', 'http://localhost:8976/dev', 'humanlayer-electron-local-updater'],
	])('writes the expected updater configuration for %s', (productName, url, updaterCacheDirName) => {
		expect(appUpdateManifestForProductName(productName)).toBe(
			['provider: generic', `url: ${url}`, `updaterCacheDirName: ${updaterCacheDirName}`, ''].join('\n'),
		)
	})

	test('rejects unsupported application names', () => {
		expect(() => appUpdateManifestForProductName('UnexpectedApplication')).toThrow(
			'Unsupported Electron product name',
		)
	})
})
