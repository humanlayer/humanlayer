import type { HostLogLevel } from '@humanlayer/riptide-electron-rpc'

import { writeHostLog as writeElectronHostLog } from '@/integrations/electron/host-logging'
import { isElectron, isTauri } from '@/lib/utils'

export async function writeHostLog(input: { readonly level: HostLogLevel; readonly message: string }): Promise<void> {
	if (isElectron()) return writeElectronHostLog(input)
	if (!isTauri()) return

	const tauriLog = await import('@tauri-apps/plugin-log')
	switch (input.level) {
		case 'fatal':
		case 'error':
			await tauriLog.error(input.message)
			break
		case 'warn':
			await tauriLog.warn(input.message)
			break
		case 'info':
			await tauriLog.info(input.message)
			break
		case 'debug':
			await tauriLog.debug(input.message)
			break
		case 'trace':
			await tauriLog.trace(input.message)
			break
	}
}
