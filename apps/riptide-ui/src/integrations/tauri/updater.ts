import {
	DownloadCompleted,
	DownloadProgress,
	type UpdateEvent,
	type UpdateInfo,
} from '@humanlayer/riptide-electron-rpc'
import type { Update } from '@tauri-apps/plugin-updater'
import z from 'zod/v4'

import { logger } from '@/lib/logger'
import { isTauri } from '@/lib/utils'

// Module-level state: the pending Update object from the last check. Callers
// never see this -- they get a mapped UpdateInfo and call downloadTauriUpdate()
// / installAndRelaunchTauri() without passing the raw object back.
let pendingUpdate: Update | null = null

const UpdateMetadataSchema = z.object({ urgency: z.literal('critical') })
const UpdateStartedDataSchema = z.object({ contentLength: z.number().optional() })
const UpdateProgressDataSchema = z.object({ chunkLength: z.number() })

/**
 * Check for available updates.
 * Returns a platform-agnostic UpdateInfo if an update is available, null otherwise.
 * Stores the raw Update object internally for subsequent download/install calls.
 */
export async function checkForTauriUpdate(): Promise<UpdateInfo | null> {
	if (!isTauri()) return null

	try {
		const { check } = await import('@tauri-apps/plugin-updater')
		const update = await check()
		if (!update) {
			pendingUpdate = null
			return null
		}

		pendingUpdate = update

		const rawJson = Object.fromEntries(Object.entries(update))
		return {
			version: update.version,
			notes: typeof update.body === 'string' ? update.body : '',
			urgency: UpdateMetadataSchema.safeParse(update).success ? 'critical' : 'normal',
			rawJson,
		}
	} catch (error) {
		logger.error('Failed to check for update', { error })
		return null
	}
}

/**
 * Download the pending update, emitting UpdateEvent progress events.
 *
 * Accumulates Tauri's raw Started/Progress/Finished chunk events into the
 * common UpdateEvent tagged union so the facade and UI see one shape.
 */
export async function downloadTauriUpdate(onEvent: (event: UpdateEvent) => void): Promise<void> {
	if (!isTauri() || !pendingUpdate) return

	const update = pendingUpdate
	let transferred = 0
	let total = 0
	let lastTimestamp = Date.now()

	await update.download((event) => {
		if (event.event === 'Started') {
			transferred = 0
			const startedData = UpdateStartedDataSchema.safeParse(event.data)
			total = startedData.success ? (startedData.data.contentLength ?? 0) : 0
			lastTimestamp = Date.now()
		} else if (event.event === 'Progress') {
			const progressData = UpdateProgressDataSchema.safeParse(event.data)
			if (!progressData.success) return
			const { chunkLength } = progressData.data
			const now = Date.now()
			const elapsed = (now - lastTimestamp) / 1000
			transferred += chunkLength
			lastTimestamp = now

			onEvent(
				DownloadProgress.make({
					delta: chunkLength,
					transferred,
					total,
					percent: total > 0 ? (transferred / total) * 100 : 0,
					bytesPerSecond: elapsed > 0 ? chunkLength / elapsed : 0,
				}),
			)
		} else if (event.event === 'Finished') {
			onEvent(DownloadCompleted.make({ version: update.version }))
		}
	})
}

/**
 * Install the downloaded update and relaunch the application.
 */
export async function installAndRelaunchTauri(): Promise<void> {
	if (!isTauri()) return

	if (pendingUpdate) {
		await pendingUpdate.install()
	}

	const { relaunch } = await import('@tauri-apps/plugin-process')
	await relaunch()
}
