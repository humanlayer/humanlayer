import { open } from '@tauri-apps/plugin-dialog'

import { isTauri } from '@/lib/utils'

export async function pickExistingDirectory(): Promise<string | null> {
	if (!isTauri()) return null
	const selected = await open({ directory: true, multiple: false })
	return typeof selected === 'string' ? selected : null
}
