import { memo } from 'react'
import { MultiFileDiff } from '@pierre/diffs/react'
import { useDiffStyle } from '../diff-style-provider'
import { useTheme } from '../theme-provider'
import { themeToShiki } from '../../lib/shiki-theme-mapping'
import { diffLayoutUnsafeCSS, diffThemeStyleOverrides } from './diff-style-overrides'

export interface DiffViewerProps {
	oldContent: string
	newContent: string
	mode?: 'split' | 'unified'
	showFullFile?: boolean
	fileSnapshot?: string
	fileName?: string
}

export const DiffViewer = memo(function DiffViewer({
	oldContent,
	newContent,
	mode,
	showFullFile = false,
	fileSnapshot,
	fileName,
}: DiffViewerProps) {
	const { theme } = useTheme()
	const { diffStyle } = useDiffStyle()
	const resolvedMode = mode ?? diffStyle
	const shikiTheme = themeToShiki[theme] ?? 'github-dark'

	// When showFullFile + fileSnapshot are both provided, apply the edit to
	// the snapshot to produce before/after full-file contents.
	let oldFileContents = oldContent ?? ''
	let newFileContents = newContent ?? ''

	if (showFullFile && fileSnapshot) {
		const idx = fileSnapshot.indexOf(oldContent)
		if (idx !== -1) {
			oldFileContents = fileSnapshot
			newFileContents =
				fileSnapshot.slice(0, idx) + newContent + fileSnapshot.slice(idx + oldContent.length)
		}
	}

	// Ensure content ends with newline to prevent "No newline at end of file" indicator
	if (oldFileContents && !oldFileContents.endsWith('\n')) oldFileContents += '\n'
	if (newFileContents && !newFileContents.endsWith('\n')) newFileContents += '\n'

	const name = fileName ?? 'file'

	return (
		<MultiFileDiff
			oldFile={{ name, contents: oldFileContents }}
			newFile={{ name, contents: newFileContents }}
			style={diffThemeStyleOverrides}
			options={{
				theme: shikiTheme,
				diffStyle: resolvedMode === 'split' ? 'split' : 'unified',
				diffIndicators: 'classic',
				disableFileHeader: true,
				overflow: 'wrap',
				unsafeCSS: diffLayoutUnsafeCSS,
			}}
		/>
	)
})
DiffViewer.displayName = 'DiffViewer'
