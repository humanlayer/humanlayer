// The extension's settings in pi's own settings.json, under "humanlayer". Today that is only
// defaultMirroring: whether a new session mirrors before /humanlayer on or off says otherwise.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getAgentDir } from '@earendil-works/pi-coding-agent'

import { withFileLock, writeJsonFileAtomic } from './util.ts'

export type Mirroring = 'on' | 'off'

export interface HumanlayerSettings {
	defaultMirroring: Mirroring
}

export const isMirroring = (value: unknown): value is Mirroring => value === 'on' || value === 'off'

const settingsFilePath = () => join(getAgentDir(), 'settings.json')

/** The whole settings.json, checked: a file that isn't JSON or holds a bad "humanlayer" throws. */
async function readSettingsDocument(): Promise<Record<string, unknown>> {
	let text: string
	try {
		text = await readFile(settingsFilePath(), 'utf8')
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
		throw err
	}
	const document: unknown = JSON.parse(text)
	if (!document || typeof document !== 'object' || Array.isArray(document))
		throw new Error('Pi settings.json must contain an object')
	const settings = (document as Record<string, unknown>).humanlayer
	if (settings !== undefined) {
		if (!settings || typeof settings !== 'object' || Array.isArray(settings))
			throw new Error('Pi settings.json humanlayer must contain an object')
		const mirroring = (settings as Record<string, unknown>).defaultMirroring
		if (mirroring !== undefined && !isMirroring(mirroring))
			throw new Error('humanlayer.defaultMirroring must be on or off')
	}
	return document as Record<string, unknown>
}

export async function loadSettings(): Promise<HumanlayerSettings> {
	const document = await readSettingsDocument()
	const settings = document.humanlayer as Partial<HumanlayerSettings> | undefined
	return { defaultMirroring: settings?.defaultMirroring ?? 'on' }
}

/** Merges into settings.json, keeping pi's own settings and any other HumanLayer ones. */
export async function saveSettings(settings: Partial<HumanlayerSettings>): Promise<void> {
	const file = settingsFilePath()
	await withFileLock(`${file}.humanlayer.lock`, async () => {
		const document = await readSettingsDocument()
		document.humanlayer = { ...(document.humanlayer as object | undefined), ...settings }
		await writeJsonFileAtomic(file, document)
	})
}

export const settingsStatusLine = (settings: HumanlayerSettings) => `default mirroring: ${settings.defaultMirroring}`
