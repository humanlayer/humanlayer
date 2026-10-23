import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOST_ID_DIR = join(homedir(), '.humanlayer', 'riptide')

export function getHostIdFilePath(hostIdDirectory: string, stackId: string | undefined): string {
	return join(hostIdDirectory, stackId ? `host_id_${stackId}` : 'host_id')
}

function hostIdFile(): string {
	return getHostIdFilePath(HOST_ID_DIR, process.env.DEVSTACK_ID)
}

let cachedHostId: string | null = null

export async function getHostId(): Promise<string> {
	if (cachedHostId) return cachedHostId

	try {
		const existing = (await readFile(hostIdFile(), 'utf-8')).trim()
		if (existing) {
			cachedHostId = existing
			return existing
		}
	} catch {
		// File doesn't exist, create it
	}

	await mkdir(HOST_ID_DIR, { recursive: true })
	const newId = crypto.randomUUID()
	await writeFile(hostIdFile(), newId)
	cachedHostId = newId
	return newId
}
