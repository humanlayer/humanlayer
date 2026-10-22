import { isElectron } from './utils'

export async function copyAsyncTextToClipboard(textPromise: Promise<string>): Promise<void> {
	if (isElectron()) {
		await navigator.clipboard.writeText(await textPromise)
		return
	}

	await navigator.clipboard.write([
		new ClipboardItem({ 'text/plain': textPromise.then((text) => new Blob([text], { type: 'text/plain' })) }),
	])
}
