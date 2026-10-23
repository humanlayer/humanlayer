import {
	MarkdownViewer as BaseMarkdownViewer,
	type MarkdownViewerProps as BaseMarkdownViewerProps,
} from '@humanlayer/ui/markdown-viewer/MarkdownViewer'

import { riptideLanguageRenderers } from './language-renderers'

export type MarkdownViewerProps = Omit<BaseMarkdownViewerProps, 'customLanguageRenderers'>

/**
 * MarkdownViewer with task-artifact code block support.
 * Wraps packages/ui MarkdownViewer with task-artifact renderer.
 */
export function MarkdownViewer(props: MarkdownViewerProps) {
	return <BaseMarkdownViewer {...props} customLanguageRenderers={riptideLanguageRenderers} />
}
