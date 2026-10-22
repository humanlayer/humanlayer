import { stat } from 'node:fs/promises'

/**
 * Per-session memory of which on-disk artifact state has already reached the
 * cloud, shared by every PostToolUse sync hook of that session. A fingerprint
 * is mtime plus size, cheap enough to check after every tool call.
 */
export interface ArtifactSyncLedger {
	record(fileName: string, fingerprint: string): void
	isCurrent(fileName: string, fingerprint: string): boolean
}

export function createArtifactSyncLedger(): ArtifactSyncLedger {
	const fingerprints = new Map<string, string>()
	return {
		record: (fileName, fingerprint) => {
			fingerprints.set(fileName, fingerprint)
		},
		isCurrent: (fileName, fingerprint) => fingerprints.get(fileName) === fingerprint,
	}
}

export async function readFileFingerprint(filePath: string): Promise<string> {
	const fileStat = await stat(filePath)
	return `${fileStat.mtimeMs}:${fileStat.size}`
}

export async function recordSyncedFile(ledger: ArtifactSyncLedger, fileName: string, filePath: string): Promise<void> {
	const fingerprint = await readFileFingerprint(filePath).catch(() => null)
	if (fingerprint) ledger.record(fileName, fingerprint)
}
