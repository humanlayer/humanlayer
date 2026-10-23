import type { UpdateCheckResult } from 'electron-updater'

type NativeUpdateCheckResult = Pick<UpdateCheckResult, 'isUpdateAvailable' | 'updateInfo'>

export function isUpdateAvailable(
	result: NativeUpdateCheckResult | null,
): result is NativeUpdateCheckResult & { readonly isUpdateAvailable: true } {
	return result !== null && result.isUpdateAvailable
}
