import {
	ArtifactDocument,
	ArtifactViewerDisplay,
	ArtifactViewerV2 as ArtifactViewerV2Shell,
	ArtifactViewerWorkspace,
	MarkdownViewerV2,
	useMarkdownViewerV2Editor,
} from '@humanlayer/ui/artifact-viewer-v2'
import { ArtifactViewerTabs, ContentCopyButton, type ArtifactViewMode } from '@humanlayer/ui/components/artifact-viewer'
import { Button } from '@humanlayer/ui/components/button'
import type { JsonArtifactSearchHandle } from '@humanlayer/ui/components/json-artifact/json-artifact-search'
import type { CustomLanguageRenderers } from '@humanlayer/ui/markdown-viewer/CodeBlock'
import type { Editor } from '@tiptap/react'
import { Search } from 'lucide-react'
import { useCallback, type MutableRefObject, type ReactNode, type RefObject } from 'react'

export interface ReadonlyArtifactViewerV2Props {
	content: string
	fileName: string
	displayMode: 'sidebar' | 'fullscreen'
	viewMode: ArtifactViewMode
	onViewModeChange: (mode: ArtifactViewMode) => void
	externalEditorRef?: MutableRefObject<Editor | null>
	searchQuery?: string
	searchCurrentMatch?: { line: number; occurrence: number; charIndex: number } | null
	searchEnabled?: boolean
	onSearchToggleRequest?: () => void
	hideHeader?: boolean
	actionsMenu?: ReactNode
	customLanguageRenderers?: CustomLanguageRenderers
	structuredSearchRef?: RefObject<JsonArtifactSearchHandle | null>
	children?: ReactNode
}

export function ReadonlyArtifactViewerV2(props: ReadonlyArtifactViewerV2Props) {
	return <ReadonlyArtifactViewerV2Composition key={`${props.fileName}:${props.content}`} {...props} />
}

function ReadonlyArtifactViewerV2Composition({
	content,
	fileName,
	displayMode,
	viewMode,
	onViewModeChange,
	externalEditorRef,
	searchQuery,
	searchCurrentMatch,
	searchEnabled = true,
	onSearchToggleRequest,
	hideHeader = false,
	actionsMenu,
	customLanguageRenderers,
	structuredSearchRef,
	children,
}: ReadonlyArtifactViewerV2Props) {
	const editor = useMarkdownViewerV2Editor({ content, customLanguageRenderers })
	const syncExternalEditor = useCallback(
		(node: HTMLSpanElement | null) => {
			if (externalEditorRef) externalEditorRef.current = node ? editor : null
		},
		[editor, externalEditorRef],
	)

	return (
		<ArtifactViewerV2Shell>
			<span ref={syncExternalEditor} hidden />
			{!hideHeader ? (
				<div className="flex h-12 items-center gap-2 border-b border-border bg-background px-2">
					<ArtifactViewerTabs
						value={viewMode}
						onValueChange={onViewModeChange}
						fileName={fileName}
						variant="underline"
					/>
					{actionsMenu}
					{searchEnabled && onSearchToggleRequest ? (
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6"
							onClick={onSearchToggleRequest}
							aria-label="Search in artifact"
						>
							<Search className="h-3 w-3" />
						</Button>
					) : null}
					<ContentCopyButton content={content} />
				</div>
			) : null}
			<ArtifactViewerWorkspace
				layoutId={viewMode === 'rendered' ? `${displayMode}-readonly` : `${displayMode}-readonly-raw`}
			>
				<ArtifactDocument>
					{children ? <div className="artifact-viewer-v2-search">{children}</div> : null}
					<ArtifactViewerDisplay
						content={content}
						fileName={fileName}
						viewMode={viewMode === 'rendered' ? 'rendered' : 'raw'}
						renderedMarkdown={<MarkdownViewerV2 editor={editor} />}
						searchQuery={searchQuery}
						searchCurrentMatch={searchCurrentMatch}
						structuredSearchRef={structuredSearchRef}
					/>
				</ArtifactDocument>
			</ArtifactViewerWorkspace>
		</ArtifactViewerV2Shell>
	)
}
