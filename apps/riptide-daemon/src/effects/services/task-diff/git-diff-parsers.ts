export interface ChangedFile {
	readonly changeType: 'modified' | 'added' | 'deleted' | 'renamed'
	readonly path: string
	readonly prevPath?: string
}

/** A changed file plus the blob IDs Git recorded for each side. */
export interface RawChangedFile extends ChangedFile {
	/** Blob at the comparison base; all zeros when the file did not exist there. */
	readonly baseBlobId: string
	/** Blob in the compared index; all zeros when the file no longer exists. */
	readonly currentBlobId: string
}

/** Adds shadow-repository location flags to a regular git argument list. */
export const makeShadowGitArgs = (
	gitDir: string,
	workTree: string,
	args: ReadonlyArray<string>,
): ReadonlyArray<string> => [`--git-dir=${gitDir}`, `--work-tree=${workTree}`, ...args]

/** True for Git's all-zero object ID, which marks a side that does not exist. */
export const isNullBlobId = (blobId: string): boolean => /^0+$/.test(blobId)

/** Maps a raw status letter (with any rename score) to a change type; others are modifications. */
const changeTypeForStatus = (status: string): ChangedFile['changeType'] => {
	switch (status.charAt(0)) {
		case 'A':
			return 'added'
		case 'D':
			return 'deleted'
		case 'R':
			return 'renamed'
		default:
			return 'modified'
	}
}

/**
 * Parses `git diff --raw -z --no-abbrev` output. Each record is a metadata field
 * (`:srcMode dstMode srcBlob dstBlob status`) followed by one path, or two for a rename or copy.
 */
export const parseRawDiff = (output: string): ReadonlyArray<RawChangedFile> => {
	const fields = output.split('\0')
	const files: RawChangedFile[] = []
	let index = 0
	while (index < fields.length) {
		const meta = fields[index++]
		if (!meta) continue
		if (!meta.startsWith(':')) continue
		const [, , baseBlobId = '', currentBlobId = '', status = ''] = meta.slice(1).split(' ')
		const hasTwoPaths = status.startsWith('R') || status.startsWith('C')
		const firstPath = fields[index++]
		const secondPath = hasTwoPaths ? fields[index++] : undefined
		if (!firstPath) continue
		if (status.startsWith('R') && secondPath) {
			files.push({ changeType: 'renamed', prevPath: firstPath, path: secondPath, baseBlobId, currentBlobId })
			continue
		}
		// Copies are not requested (`-C`); treat a stray copy as its destination being added.
		if (status.startsWith('C') && secondPath) {
			files.push({ changeType: 'added', path: secondPath, baseBlobId, currentBlobId })
			continue
		}
		files.push({ changeType: changeTypeForStatus(status), path: firstPath, baseBlobId, currentBlobId })
	}
	return files
}

/**
 * Parses `git diff --numstat -z` output while preserving binary-file information. Renamed
 * files are keyed by their destination path.
 */
export const parseGitNumstat = (
	output: string,
): ReadonlyMap<string, { additions: number; deletions: number; binary: boolean }> => {
	const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>()
	const fields = output.split('\0')
	let index = 0
	while (index < fields.length) {
		const record = fields[index++]
		if (!record) continue
		const [added, deleted, inlinePath] = record.split('\t')
		if (added === undefined || deleted === undefined) continue
		let path = inlinePath
		if (path === '') {
			// Rename: the record is followed by the source and destination paths.
			index += 1
			path = fields[index++]
		}
		if (!path) continue
		const binary = added === '-' || deleted === '-'
		stats.set(path, {
			additions: binary ? 0 : Number.parseInt(added, 10),
			deletions: binary ? 0 : Number.parseInt(deleted, 10),
			binary,
		})
	}
	return stats
}

/** Splits NUL-terminated `git ls-files -z` output into paths. */
export const parseNulSeparatedPaths = (output: string): ReadonlyArray<string> =>
	output.split('\0').filter((filePath) => filePath.length > 0)

/**
 * Groups paths into argument lists small enough for one git process. Limits are well under
 * the smallest common `ARG_MAX` so long path lists never fail to spawn.
 */
export const chunkPathArguments = (
	paths: ReadonlyArray<string>,
	limits: { readonly maxCount: number; readonly maxBytes: number } = { maxCount: 1000, maxBytes: 64 * 1024 },
): ReadonlyArray<ReadonlyArray<string>> => {
	const chunks: string[][] = []
	let current: string[] = []
	let currentBytes = 0
	for (const filePath of paths) {
		const bytes = Buffer.byteLength(filePath) + 1
		if (current.length > 0 && (current.length >= limits.maxCount || currentBytes + bytes > limits.maxBytes)) {
			chunks.push(current)
			current = []
			currentBytes = 0
		}
		current.push(filePath)
		currentBytes += bytes
	}
	if (current.length > 0) chunks.push(current)
	return chunks
}
