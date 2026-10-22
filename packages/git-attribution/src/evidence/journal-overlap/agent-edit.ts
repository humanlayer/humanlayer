import { buildLineHashSet } from '../../shared/line-hash'

/**
 * The one place that knows how to turn a file-writing tool call into the line-hashes an agent
 * authored. LEAF module (only ./line-hash) so every entry point can reach it:
 *   - the daemon's Claude SDK event stream (workflows/process-events -> authorship, in-memory),
 *   - the CodeLayer and Fold post-tool hooks, whose toolsets use lowercase tool names and —
 *     in codex mode — `apply_patch` instead of edit/write.
 *
 * Keeping the extraction here (rather than duplicating it per entry point) is the whole point: two
 * producers that disagree about what "the agent wrote this" means would produce authorship sets
 * that attribute differently depending on how the session happened to be launched.
 */

/** `Edit`/`edit`/`MultiEdit`/`multi_edit`/`apply_patch` etc. collapse to one comparable key. */
function normalizeToolName(toolName: string): string {
	return toolName.toLowerCase().replace(/[_-]/g, '')
}

/**
 * The lines an OpenAI-style `apply_patch` payload ADDS. In that format (`*** Begin Patch` /
 * `*** Update File:` sections) every added line starts with a single `+`; context lines start
 * with a space and removals with `-`. Headers start with `***`, so a bare prefix check is enough.
 */
function addedLinesFromPatchText(patchText: string): string[] {
	const added: string[] = []
	for (const line of patchText.split('\n')) {
		if (line.startsWith('+')) added.push(line.slice(1))
	}
	return added
}

function editReplacementTexts(edits: unknown): string[] {
	const decodedEdits = (() => {
		if (Array.isArray(edits)) return edits
		if (typeof edits !== 'string') return []
		try {
			const parsed: unknown = JSON.parse(edits)
			return Array.isArray(parsed) ? parsed : []
		} catch {
			return []
		}
	})()
	const texts: string[] = []
	for (const edit of decodedEdits) {
		if (edit === null || typeof edit !== 'object') continue
		const candidate = edit as Record<string, unknown>
		const newText = typeof candidate.new_string === 'string' ? candidate.new_string : candidate.newText
		if (typeof newText === 'string') texts.push(newText)
	}
	return texts
}

/** Extract the inserted text a file-writing tool call adds, for line-hash accumulation. */
function extractInsertedText(toolName: string, toolInput: unknown): string[] {
	if (toolInput === null || typeof toolInput !== 'object') return []
	const input = toolInput as Record<string, unknown>
	switch (normalizeToolName(toolName)) {
		case 'edit': {
			const direct = typeof input.new_string === 'string' ? input.new_string : input.newText
			const insertedText: string[] = []
			if (typeof direct === 'string') insertedText.push(direct)
			insertedText.push(...editReplacementTexts(input.edits))
			return insertedText
		}
		case 'write':
			return typeof input.content === 'string' ? [input.content] : []
		case 'multiedit': {
			return editReplacementTexts(input.edits)
		}
		case 'applypatch':
			return typeof input.patch_text === 'string' ? addedLinesFromPatchText(input.patch_text) : []
		default:
			return []
	}
}

/** The normalized line-hashes one file-writing tool call contributes (empty for everything else). */
export function agentEditLineHashes(toolName: string, toolInput: unknown): Set<string> {
	const texts = extractInsertedText(toolName, toolInput)
	if (texts.length === 0) return new Set<string>()
	return buildLineHashSet(texts)
}
