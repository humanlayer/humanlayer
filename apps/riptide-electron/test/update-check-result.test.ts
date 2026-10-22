import { describe, expect, test } from 'vitest'

import { isUpdateAvailable } from '../src/updater/update-check-result'

const updateInfo = {
	version: '0.163.2',
	files: [],
	path: 'HumanLayerElectronDev-0.163.2-arm64.zip',
	sha512: 'sha512',
	releaseDate: '2026-08-21T18:56:49.621Z',
}

describe('isUpdateAvailable', () => {
	test('does not expose the current server version as an available update', () => {
		expect(isUpdateAvailable({ isUpdateAvailable: false, updateInfo })).toBe(false)
	})

	test('accepts an update that electron-updater marks as available', () => {
		expect(isUpdateAvailable({ isUpdateAvailable: true, updateInfo })).toBe(true)
	})
})
