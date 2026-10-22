import { cn } from '@humanlayer/ui/lib/utils'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { Check, ChevronLeft, ChevronRight, Copy, Download, Expand, Search, X } from 'lucide-react'
import { type FC, type Key, type ReactNode, useCallback, useState } from 'react'
import { ArtifactRaw } from './artifact-raw'
import { JsonArtifactView } from './json-artifact/json-artifact-view'
import type { JsonArtifactSearchHandle } from './json-artifact/json-artifact-search'
import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import type { Editor } from '@tiptap/react'
import { MarkdownViewer, type CommentData, type SelectionInfo } from '../markdown-viewer/MarkdownViewer'
import type { ExternalBlockComment, BlockClickInfo, CommentBlockHoverInfo, CommentClickInfo } from '../markdown-viewer/CommentGutter'
import type { CustomLanguageRenderers } from '../markdown-viewer/CodeBlock'
import type { GutterItemInfo } from '../markdown-viewer/CommentGutterOverlay'
import {
  isHtmlFile,
  isImageFile,
  isJsonFile,
  isJsonlFile,
  isPdfFile,
  isPreviewableFile,
  isRenderedArtifactFile,
} from '@humanlayer/ui/lib/file-types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'
import { DropdownMenuItem } from './dropdown-menu'

export type ArtifactViewMode = 'rendered' | 'raw' | 'diff'

// A srcdoc frame inherits the app origin, so allow-same-origin would hand
// artifact scripts the app's storage and cookies. Keep it out of this list.
const HTML_SRCDOC_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox'

export interface ArtifactViewerViewOption {
	value: ArtifactViewMode
	label: string
	disabled: boolean
}

export function getArtifactViewerViewOptions(fileName?: string, includeDiff = false): ArtifactViewerViewOption[] {
	const name = fileName ?? ''
	const previewable = isPreviewableFile(name)
	const options: ArtifactViewerViewOption[] = [
		{
			value: 'rendered',
			label: 'RENDERED',
			disabled: !isRenderedArtifactFile(name) || previewable,
		},
		{ value: 'raw', label: 'RAW', disabled: previewable },
	]
	if (includeDiff) options.push({ value: 'diff', label: 'DIFF', disabled: true })
	return options
}

export function getDisplayedArtifactViewMode(fileName: string | undefined, viewMode: ArtifactViewMode): ArtifactViewMode {
	return isPreviewableFile(fileName ?? '') ? 'rendered' : viewMode
}

/**
 * Returns true when in-app search is applicable to this artifact type.
 * Image, PDF, HTML, and unsupported S3 previews do not support in-app search
 * so the browser's native find can still work for those.
 */
export function isArtifactSearchEnabled(fileName?: string, storageType?: string): boolean {
  const fname = fileName ?? ''
  const isImage = isImageFile(fname)
  const isPdf = isPdfFile(fname)
  const isHtml = isHtmlFile(fname)
  const isPreviewable = isPreviewableFile(fname)
  const isS3 = storageType === 's3'
  return !(isImage || isPdf || isHtml || (isS3 && !isPreviewable))
}

export interface ArtifactViewerProps {
  content: string
  fileName?: string
  /** Pre-signed URL for S3-stored artifacts (images, PDFs) */
  imageUrl?: string | null
  /** HTML document with relative asset references already rewritten to absolute URLs.
   *  When set, HTML previews render it via srcdoc instead of loading imageUrl. */
  htmlSrcDoc?: string | null
  /** Rekeys iframe previews when the backing artifact changes without changing its URL. */
  iframeRenderKey?: Key
  /** Storage type of the artifact ('postgres' | 's3') */
  storageType?: string
  className?: string
  defaultView?: ArtifactViewMode
  /** Controlled mode: current tab value */
  tabValue?: ArtifactViewMode
  /** Controlled mode: callback when tab changes */
  onTabValueChange?: (value: ArtifactViewMode) => void
  /** Show shift+h/l resize hotkey hints (default: false) */
  showResizeHotkeys?: boolean
  /** Make the header sticky when scrolling (default: false) */
  stickyHeader?: boolean
  /** Callback to expand panel (shown as left arrow when provided) */
  onExpand?: () => void
  /** Callback to collapse panel (shown as right arrow when provided) */
  onCollapse?: () => void
  /** Hide outer border (useful when embedded in a panel with its own border) */
  noBorder?: boolean
  /** Callback to close panel (shows X button when provided) */
  onClose?: () => void
  /** Optional actions menu rendered after the view tabs */
  actionsMenu?: ReactNode
  /** Show keyboard shortcut hints in the header (default: true) */
  showHotkeyHints?: boolean
  /** Callback to enter fullscreen mode (shows maximize button when provided) */
  onFullscreen?: () => void
  /** When true, shows 'f' → 'exit fullscreen' hint (for use inside fullscreen overlay) */
  isFullscreen?: boolean
  /** Hide the internal header (tabs, copy button, etc.) - use when rendering header externally */
  hideHeader?: boolean
  /** Inline comments to highlight in the rendered markdown */
  comments?: CommentData[]
  /** Block-level comments (for code blocks, blockquotes, etc.) */
  blockComments?: ExternalBlockComment[]
  /** Fired when a commented block is clicked */
  onCommentClick?: (info: CommentClickInfo) => void
  /** Fired when any block is clicked (for adding block-level comments) */
  onBlockClick?: (info: BlockClickInfo) => void
  /** Fired when the user selects text (empty selection = null) */
  onSelectionChange?: (info: SelectionInfo | null) => void
  /** Lines with comments — passed through to ArtifactRaw for the raw tab */
  commentedLines?: Map<number, Array<{ userId: string; displayName?: string; avatarUrl?: string }>>
  /** Callback when a line is clicked in raw view */
  onLineClick?: (lineNumber: number) => void
  /** Fired when a gutter avatar group is hovered (null = mouse left) */
  onGutterItemHover?: (info: GutterItemInfo | null) => void
  /** Fired when a gutter avatar group is clicked */
  onGutterItemClick?: (info: GutterItemInfo) => void
  /** Fired when mouse enters/leaves a commented block highlight (null = mouse left) */
  onCommentBlockHover?: (info: CommentBlockHoverInfo | null) => void
  /** Ref to access the TipTap editor instance for position calculations */
  editorRef?: React.MutableRefObject<Editor | null>
  /** Hide the comment gutter overlay AND reclaim the right-hand padding reserved
   *  for it. Useful for narrow viewports where commenting isn't exposed. */
  hideCommentGutter?: boolean
  /** Use a tighter comment gutter that auto-hides only at very narrow widths. */
  compactCommentGutter?: boolean
  /** Custom language renderers for code blocks (e.g., { 'task-artifact': TaskArtifactViewer }) */
  customLanguageRenderers?: CustomLanguageRenderers
  /** Optional overlay rendered absolutely in the top-right of the content area
   *  (e.g., an ArtifactSearchBar). */
  children?: ReactNode
  /** When true (default), shows the Search icon in the toolbar and lets cmd+f open the bar.
   *  Wrappers set this to false for image/PDF/HTML/non-text previews. */
  searchEnabled?: boolean
  /** Fired when the Search icon is clicked; wrapper toggles the bar via its hook. */
  onSearchToggleRequest?: () => void
  /** Current search query — threaded to the Raw tab renderer (Phase 2 uses it). */
  searchQuery?: string
  /** Currently-active match — threaded to the Raw tab renderer (Phase 2 uses it). */
  searchCurrentMatch?: { line: number; occurrence: number; charIndex: number } | null
  /** Show a download button next to the copy button (default: false). Used by riptide-cloud. */
  showDownloadButton?: boolean
  /** Imperative search adapter for the rendered JSON tree. */
  structuredSearchRef?: React.RefObject<JsonArtifactSearchHandle | null>
}

export interface ContentCopyActionModel {
  copied: boolean
  copyContents: () => Promise<void>
}

export function useContentCopyAction(content: string): ContentCopyActionModel {
  const [copied, setCopied] = useState(false)
  const [, copyToClipboard] = useCopyToClipboard()

  const copyContents = useCallback(async () => {
    await copyToClipboard(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [content, copyToClipboard])

  return { copied, copyContents }
}

/** Copy-all-content button with icon-swap feedback */
export const ContentCopyButton = ({
  content,
  action,
  className,
}: {
  content?: string
  action?: ContentCopyActionModel
  className?: string
}) => {
  const ownedAction = useContentCopyAction(content ?? '')
  const copyAction = action ?? ownedAction

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6', className)}
          onClick={copyAction.copyContents}
          aria-label="Copy contents"
        >
          {copyAction.copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Copy contents</p>
      </TooltipContent>
    </Tooltip>
  )
}

export function ContentCopyMenuItem({ action }: { action: ContentCopyActionModel }) {
  return <DropdownMenuItem onSelect={() => void action.copyContents()}>Copy artifact contents</DropdownMenuItem>
}

/** Download-artifact button. For S3-stored artifacts (imageUrl present), downloads
 *  the file directly from the pre-signed URL; otherwise serializes `content` to a Blob. */
export const ContentDownloadButton = ({
  content,
  fileName,
  imageUrl,
}: {
  content: string
  fileName?: string
  imageUrl?: string | null
}) => {
  const handleDownload = async () => {
    const downloadName = fileName ?? 'artifact'
    // The `download` attribute is ignored for cross-origin hrefs, so for S3-stored
    // artifacts (pre-signed URL) we fetch the bytes and download via a same-origin
    // blob URL — otherwise the browser just opens the file in a new tab.
    let objectUrl: string
    if (imageUrl) {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      objectUrl = URL.createObjectURL(blob)
    } else {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      objectUrl = URL.createObjectURL(blob)
    }
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = downloadName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(objectUrl)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleDownload}
          aria-label="Download file"
        >
          <Download className="h-3 w-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Download file</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** Props for standalone ArtifactViewerTabs used in external headers */
export interface ArtifactViewerTabsProps {
  value: ArtifactViewMode
  onValueChange: (value: ArtifactViewMode) => void
  /** File name to determine if markdown/raw toggle should be enabled */
  fileName?: string
  /** Size variant */
  size?: 'sm' | 'default'
  /**
   * Visual style. 'boxed' (default) is the muted pill used in inline viewer
   * headers. 'underline' is the quiet, box-free titlebar treatment where the
   * active tab carries a bottom accent bar instead of a filled pill; use it in
   * titlebar rows so the toggle recedes into the header chrome.
   */
  variant?: 'boxed' | 'underline'
	/** Controlled view choices. Phase 3 can append Diff without moving mode state. */
	views?: readonly ArtifactViewerViewOption[]
}

/**
 * Standalone RENDERED/RAW tabs for use in external headers.
 * Wraps itself in an isolated Tabs context so it doesn't interfere with
 * any parent Tabs (e.g., sidebar tabs).
 */
export const ArtifactViewerTabs: FC<ArtifactViewerTabsProps> = ({
  value,
  onValueChange,
  fileName,
  size = 'sm',
  variant = 'boxed',
	views,
}) => {
  const viewOptions = views ?? getArtifactViewerViewOptions(fileName)
  const isUnderline = variant === 'underline'
  // Boxed keeps the pill's fixed height; underline fills the host row so the
  // active trigger's 2px accent bar sits flush on the row's bottom hairline
  // (the host header must stretch this component to its full height).
  const listHeight = isUnderline ? 'h-full' : size === 'sm' ? 'h-7' : 'h-8'
  const triggerClassName = isUnderline
    ? 'relative z-10 cursor-pointer text-xs px-2'
    : size === 'sm'
      ? 'cursor-pointer text-xs px-2 h-5'
      : 'cursor-pointer text-xs px-3 h-6'

  return (
    <Tabs
      value={getDisplayedArtifactViewMode(fileName, value)}
      onValueChange={(v) => onValueChange(v as ArtifactViewMode)}
      className={isUnderline ? 'ml-1 h-full' : undefined}
    >
      <TabsList
        variant={variant}
        className={cn(
          listHeight,
          isUnderline && 'relative',
        )}
      >
		{viewOptions.map((option) => (
			<TabsTrigger
				key={option.value}
				value={option.value}
				className={triggerClassName}
				disabled={option.disabled}
			>
				{option.label}
			</TabsTrigger>
		))}
      </TabsList>
    </Tabs>
  )
}

export const ArtifactViewer: FC<ArtifactViewerProps> = ({
  content,
  fileName,
  imageUrl,
  htmlSrcDoc,
  iframeRenderKey,
  storageType,
  className,
  defaultView = 'rendered',
  tabValue,
  onTabValueChange,
  showResizeHotkeys = false,
  stickyHeader = false,
  onExpand,
  onCollapse,
  noBorder = false,
  onClose,
  actionsMenu,
  showHotkeyHints = true,
  onFullscreen,
  isFullscreen = false,
  hideHeader = false,
  comments,
  blockComments,
  onCommentClick,
  onBlockClick,
  onSelectionChange,
  commentedLines,
  onLineClick,
  onGutterItemHover,
  onGutterItemClick,
  onCommentBlockHover,
  editorRef,
  hideCommentGutter = false,
  compactCommentGutter = false,
  customLanguageRenderers,
  children,
  searchEnabled = true,
  onSearchToggleRequest,
  searchQuery,
  searchCurrentMatch,
  showDownloadButton = false,
  structuredSearchRef,
}) => {
  const jsonFile = isJsonFile(fileName ?? '')
  const jsonlFile = isJsonlFile(fileName ?? '')
  const structuredFile = jsonFile || jsonlFile
  const supportsRenderedView = isRenderedArtifactFile(fileName ?? '')
	const viewOptions = getArtifactViewerViewOptions(fileName)
  const isImage = isImageFile(fileName ?? '')
  const isPdf = isPdfFile(fileName ?? '')
  const isHtml = isHtmlFile(fileName ?? '')
  const isPreviewable = isPreviewableFile(fileName ?? '')
  const isS3Artifact = storageType === 's3'
  const isControlled = tabValue !== undefined
  const showResizeArrows = onExpand || onCollapse

  const tabsContent = (
    <>
      <TabsContent value="rendered" className={structuredFile ? 'm-0 h-full min-h-0' : 'm-0 p-4'}>
        {structuredFile ? (
          <JsonArtifactView ref={structuredSearchRef} content={content} kind={jsonlFile ? 'jsonl' : 'json'} />
        ) : (
          <MarkdownViewer
            key={content}
            content={content}
            comments={comments}
            blockComments={blockComments}
            onCommentClick={onCommentClick}
            onBlockClick={onBlockClick}
            onSelectionChange={onSelectionChange}
            onGutterItemHover={onGutterItemHover}
            onGutterItemClick={onGutterItemClick}
            onCommentBlockHover={onCommentBlockHover}
            editorRef={editorRef}
            hideCommentGutter={hideCommentGutter}
            compactCommentGutter={compactCommentGutter}
            customLanguageRenderers={customLanguageRenderers}
          />
        )}
      </TabsContent>
      <TabsContent value="raw" className="m-0">
        <ArtifactRaw
          content={content}
          commentedLines={commentedLines}
          onLineClick={onLineClick}
          searchQuery={searchQuery}
          searchCurrentMatch={searchCurrentMatch}
        />
      </TabsContent>
    </>
  )

  const tabsElement = (
    <Tabs
      defaultValue={isControlled ? undefined : getDisplayedArtifactViewMode(fileName, supportsRenderedView ? defaultView : 'raw')}
      value={isControlled ? getDisplayedArtifactViewMode(fileName, tabValue) : undefined}
      onValueChange={isControlled ? (v) => onTabValueChange?.(v as ArtifactViewMode) : undefined}
      className={cn('gap-0', structuredFile && 'h-full min-h-0')}
    >
      {!hideHeader && (
        <div className={cn(
          "flex h-12 items-center gap-2 border-b border-border px-2 bg-background",
          stickyHeader && "sticky top-0 z-20"
        )}>
          {/* Resize arrows */}
          {showResizeArrows && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5"
                    onClick={onExpand}
                    disabled={!onExpand}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Expand</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5"
                    onClick={onCollapse}
                    disabled={!onCollapse}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Collapse</TooltipContent>
              </Tooltip>
            </div>
          )}
		  <TabsList
			variant="underline"
			className="relative ml-1 h-full flex-shrink-0 after:absolute after:inset-x-0 after:bottom-0 after:z-0 after:h-0.5 after:bg-border/60"
		  >
			{viewOptions.map((option) => (
				<TabsTrigger key={option.value} value={option.value} disabled={option.disabled} className="relative z-10 cursor-pointer">
					{option.label}
				</TabsTrigger>
			))}
		  </TabsList>
          {actionsMenu}
          {searchEnabled && onSearchToggleRequest && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={onSearchToggleRequest}
                  aria-label="Search in artifact"
                >
                  <Search className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="flex items-center gap-1">
                  Search{' '}
                  <KeyboardShortcut>
                    {typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
                      ? 'Cmd+f'
                      : 'Ctrl+f'}
                  </KeyboardShortcut>
                </p>
              </TooltipContent>
            </Tooltip>
          )}
          {onFullscreen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={onFullscreen}
                  aria-label="Fullscreen"
                >
                  <Expand className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="flex items-center gap-1">
                  Fullscreen <KeyboardShortcut>f</KeyboardShortcut>
                </p>
              </TooltipContent>
            </Tooltip>
          )}
          {!isS3Artifact && <ContentCopyButton content={content} />}
          {showDownloadButton && (
            <ContentDownloadButton content={content} fileName={fileName} imageUrl={imageUrl} />
          )}
          <div className="flex items-center gap-3 text-muted-foreground ml-auto overflow-hidden flex-shrink min-w-0">
            {showHotkeyHints && (
              <>
                {showResizeHotkeys && (
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <KeyboardShortcut className="!text-[10px]">⇧h/l</KeyboardShortcut>
                    <span className="text-[10px]">resize</span>
                  </span>
                )}
                <span className="flex items-center gap-1 flex-shrink-0">
                  <KeyboardShortcut className="!text-[10px]">h/l</KeyboardShortcut>
                  <span className="text-[10px]">view</span>
                </span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  <KeyboardShortcut className="!text-[10px]">j/k</KeyboardShortcut>
                  <span className="text-[10px]">scroll</span>
                </span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  <KeyboardShortcut className="!text-[10px]">gg/G</KeyboardShortcut>
                  <span className="text-[10px]">top/btm</span>
                </span>
                <span className="flex items-center gap-1 flex-shrink-0">
                  <KeyboardShortcut className="!text-[10px]">esc</KeyboardShortcut>
                  <span className="text-[10px]">back</span>
                </span>
                {onFullscreen && (
                  <span className="flex items-center gap-1 flex-shrink-0">
                    <KeyboardShortcut className="!text-[10px]">f</KeyboardShortcut>
                    <span className="text-[10px]">fullscreen</span>
                  </span>
                )}
              </>
            )}
            {onClose && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-1.5 ml-1"
                    onClick={onClose}
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="flex items-center gap-1">
                    {isFullscreen ? 'Exit fullscreen' : 'Close'}{' '}
                    <KeyboardShortcut>{isFullscreen ? 'f' : 'esc'}</KeyboardShortcut>
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      )}
      {isImage && imageUrl ? (
        <div className="flex items-center justify-center p-4 min-h-[200px]">
          <img
            src={imageUrl}
            alt={fileName ?? 'Image'}
            className="max-w-full max-h-[80vh] object-contain"
          />
        </div>
      ) : isPdf && imageUrl ? (
        <iframe
          key={iframeRenderKey}
          src={imageUrl}
          title={fileName ?? 'PDF'}
          className="w-full h-[80vh] border-0"
        />
      ) : isHtml && htmlSrcDoc ? (
        <iframe
          key={iframeRenderKey}
          srcDoc={htmlSrcDoc}
          title={fileName ?? 'HTML'}
          className="w-full h-[80vh] border-0"
          sandbox={HTML_SRCDOC_SANDBOX}
        />
      ) : isHtml && imageUrl ? (
        <iframe
          key={iframeRenderKey}
          src={imageUrl}
          title={fileName ?? 'HTML'}
          className="w-full h-[80vh] border-0"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      ) : isS3Artifact && !isPreviewable ? (
        <div className="flex items-center justify-center p-8 text-muted-foreground">
          <p>Preview not available for this file type</p>
        </div>
      ) : (
        <div className={cn('relative', structuredFile && 'h-full min-h-0')}>
          {searchEnabled && children && (
            <div
              className={cn(
                'sticky z-10 h-0 pointer-events-none',
                hideHeader ? 'top-0' : 'top-12',
              )}
            >
              <div className="absolute right-3 top-2 pointer-events-auto">{children}</div>
            </div>
          )}
          {tabsContent}
        </div>
      )}
    </Tabs>
  )

  return (
    <div className={cn(structuredFile && 'h-full min-h-0', !noBorder && 'border border-border', className)}>
      {tabsElement}
    </div>
  )
}
