export interface ParsedApplyPatchHunk {
	context?: string
	oldLines: string[]
	newLines: string[]
}

export interface ParsedApplyPatchOperation {
	type: 'add' | 'update' | 'delete' | 'move'
	filePath: string
	targetPath?: string
	content?: string
	hunks?: ParsedApplyPatchHunk[]
	rawPatch: string
}

/** Parse the file operations represented by an apply_patch body. */
export function parseApplyPatch(patchText: string): ParsedApplyPatchOperation[] {
	const operations: ParsedApplyPatchOperation[] = []
	const lines = patchText.split('\n')

	let beginIdx = lines.findIndex((line) => line.trim() === '*** Begin Patch')
	let endIdx = lines.findIndex((line) => line.trim() === '*** End Patch')

	if (beginIdx === -1) beginIdx = 0
	if (endIdx === -1) endIdx = lines.length

	const body = lines.slice(beginIdx + 1, endIdx)
	let index = 0

	while (index < body.length) {
		const line = body[index]
		if (line === undefined) break

		if (line.startsWith('*** Add File:')) {
			const filePath = line.slice('*** Add File:'.length).trim()
			const contentLines: string[] = []
			index++
			while (index < body.length) {
				const contentLine = body[index]
				if (contentLine === undefined || contentLine.startsWith('*** ')) break
				if (contentLine.startsWith('+')) contentLines.push(contentLine.slice(1))
				index++
			}
			operations.push({
				type: 'add',
				filePath,
				content: contentLines.join('\n'),
				rawPatch: `*** Add File: ${filePath}\n${contentLines.map((contentLine) => `+${contentLine}`).join('\n')}`,
			})
			continue
		}

		if (line.startsWith('*** Delete File:')) {
			const filePath = line.slice('*** Delete File:'.length).trim()
			operations.push({ type: 'delete', filePath, rawPatch: line })
			index++
			continue
		}

		if (line.startsWith('*** Update File:')) {
			const filePath = line.slice('*** Update File:'.length).trim()
			let targetPath: string | undefined
			const patchLines: string[] = [line]
			const hunks: ParsedApplyPatchHunk[] = []
			index++

			const moveLine = body[index]
			if (moveLine !== undefined && moveLine.startsWith('*** Move to:')) {
				targetPath = moveLine.slice('*** Move to:'.length).trim()
				patchLines.push(moveLine)
				index++
			}

			while (index < body.length) {
				const currentLine = body[index]
				if (
					currentLine === undefined ||
					currentLine.startsWith('*** Add File:') ||
					currentLine.startsWith('*** Delete File:') ||
					currentLine.startsWith('*** Update File:') ||
					currentLine.trim() === '*** End Patch'
				) {
					break
				}
				patchLines.push(currentLine)

				if (!currentLine.startsWith('@@')) {
					index++
					continue
				}

				const context = currentLine.slice(2).trim() || undefined
				const oldLines: string[] = []
				const newLines: string[] = []
				index++
				while (index < body.length) {
					const hunkLine = body[index]
					if (hunkLine === undefined || hunkLine.startsWith('@@') || hunkLine.startsWith('*** ')) break
					patchLines.push(hunkLine)
					if (hunkLine.startsWith('-')) oldLines.push(hunkLine.slice(1))
					else if (hunkLine.startsWith('+')) newLines.push(hunkLine.slice(1))
					else if (hunkLine.startsWith(' ')) {
						oldLines.push(hunkLine.slice(1))
						newLines.push(hunkLine.slice(1))
					}
					index++
				}
				hunks.push({ context, oldLines, newLines })
			}

			operations.push({
				type: targetPath ? 'move' : 'update',
				filePath,
				targetPath,
				hunks,
				rawPatch: patchLines.join('\n'),
			})
			continue
		}

		index++
	}

	return operations
}
