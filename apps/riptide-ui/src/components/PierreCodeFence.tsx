import { useOptionalTheme } from '@humanlayer/ui/components/theme-provider'
import { themeToCodeFenceShiki } from '@humanlayer/ui/lib/shiki-theme-mapping'
import { File as PierreFile, type SupportedLanguages } from '@pierre/diffs/react'
import type { CSSProperties } from 'react'

const codeFenceOptions = {
	disableFileHeader: true,
	disableLineNumbers: true,
	overflow: 'wrap',
} as const

const codeFenceStyle = {
	'--diffs-bg': 'color-mix(in oklab, var(--terminal-bg) 94%, black)',
} as CSSProperties

/** Code fence rendered with Pierre's single-file viewer so tokenization happens in the
 * worker pool mounted by WiredDiffWorkerPoolProvider — same pipeline as the diff views. */
export function PierreCodeFence({ code, language }: { code: string; language?: string }) {
	const themeContext = useOptionalTheme()
	const shikiTheme = themeToCodeFenceShiki(themeContext?.theme)
	// Fence languages are shiki ids, which is what Pierre binds for `lang`; unknown
	// ids fall back to plain text inside Pierre, same as unrecognized file types.
	// React Compiler keeps `file` and `options` referentially stable across renders,
	// so PierreFile only re-tokenizes when the code, language, or theme changes.
	const file = { name: 'snippet.txt', contents: code, lang: language as SupportedLanguages | undefined }
	const options = { ...codeFenceOptions, theme: shikiTheme }
	return <PierreFile file={file} options={options} style={codeFenceStyle} />
}
