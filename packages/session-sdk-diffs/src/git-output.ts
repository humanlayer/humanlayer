// Parsers for `git diff -z` output. -z keeps paths as they are: no quoting, and a tab or newline
// in a name can't split a line.

export interface ChangedFile {
	changeType: 'modified' | 'added' | 'deleted' | 'renamed'
	path: string
	prevPath?: string
}

export interface FileStats {
	additions: number
	deletions: number
	binary: boolean
}

/** `git diff -z --name-status`: a status, then one path, or two (from, to) for renames and copies. A copy counts as added. */
export function parseNameStatus(out: string): ChangedFile[] {
	const tokens = out.split('\0')
	const changes: ChangedFile[] = []
	for (let i = 0; i < tokens.length; ) {
		const status = tokens[i] ?? ''
		const pair = status.startsWith('R') || status.startsWith('C')
		const path = tokens[i + (pair ? 2 : 1)]
		if (!status || !path) break
		const prevPath = tokens[i + 1]
		if (status.startsWith('R') && prevPath) changes.push({ changeType: 'renamed', path, prevPath })
		else if (status.startsWith('A') || status.startsWith('C')) changes.push({ changeType: 'added', path })
		else changes.push({ changeType: status.startsWith('D') ? 'deleted' : 'modified', path })
		i += pair ? 3 : 2
	}
	return changes
}

/**
 * `git diff -z --numstat`, keyed by path (the new path for a rename): "added\tdeleted\tpath", or
 * "added\tdeleted\t" then from and to for a rename. "-" means binary.
 */
export function parseNumstat(out: string): Map<string, FileStats> {
	const stats = new Map<string, FileStats>()
	const tokens = out.split('\0')
	for (let i = 0; i < tokens.length; i++) {
		const [added, deleted, ...rest] = (tokens[i] ?? '').split('\t')
		if (added === undefined || deleted === undefined || rest.length === 0) continue
		let path = rest.join('\t')
		if (path === '') {
			path = tokens[i + 2] ?? ''
			i += 2
		}
		const binary = added === '-' || deleted === '-'
		stats.set(path, { additions: binary ? 0 : Number(added), deletions: binary ? 0 : Number(deleted), binary })
	}
	return stats
}
