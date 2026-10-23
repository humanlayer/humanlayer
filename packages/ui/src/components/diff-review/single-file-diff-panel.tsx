import { PatchDiff } from '@pierre/diffs/react'
import { DiffLoadingSkeleton } from './diff-loading-skeleton'

import { themeToShiki } from '../../lib/shiki-theme-mapping'
import { useDiffStyle } from '../diff-style-provider'
import { useTheme } from '../theme-provider'
import { diffLayoutUnsafeCSS, diffThemeStyleOverrides } from '../conversation-stream/diff-style-overrides'

export interface SingleFileDiffPanelProps {
	fileName: string
	patch?: string
	binary?: boolean
	loading?: boolean
}

export function SingleFileDiffPanel({ fileName, patch, binary = false, loading = false }: SingleFileDiffPanelProps) {
	const { theme } = useTheme()
	const { diffStyle } = useDiffStyle()

	if (binary) return <DiffPlaceholder title={fileName} message="Binary file cannot be displayed." />
	if (loading || !patch) return <div className="min-h-0 flex-1 overflow-hidden" data-testid="single-file-diff-panel"><DiffLoadingSkeleton diffStyle={diffStyle} /></div>

	return (
		<div className="min-h-0 flex-1 overflow-auto bg-background" data-testid="single-file-diff-panel">
			<PatchDiff
				patch={patch}
				style={diffThemeStyleOverrides}
				options={{
					theme: themeToShiki[theme] ?? 'github-dark',
					diffStyle,
					diffIndicators: 'classic',
					disableFileHeader: true,
					overflow: 'wrap',
					unsafeCSS: diffLayoutUnsafeCSS,
				}}
			/>
		</div>
	)
}

function DiffPlaceholder({ title, message }: { title: string; message: string }) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center bg-background p-8" data-testid="single-file-diff-panel">
			<div className="max-w-md border border-dashed border-border px-6 py-5 text-center">
				<p className="truncate text-sm font-medium">{title}</p>
				<p className="mt-1 text-xs text-muted-foreground">{message}</p>
			</div>
		</div>
	)
}
