import { Dialog, DialogContent } from '@humanlayer/ui/components/dialog'
import { isHtmlFile, isImageFile } from '@humanlayer/ui/lib/file-types'
import type { Key } from 'react'

export interface ArtifactFullscreenModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName: string
  url: string
  /** Rekeys iframe previews when the backing artifact changes without changing its URL. */
  iframeRenderKey?: Key
  /** App-supplied iframe sandbox string; applied only to the HTML iframe (pdf gets none). */
  htmlSandbox?: string
}

/**
 * Content-only fullscreen modal for previewable artifacts (image / HTML / PDF).
 *
 * Stateless: each app decides when to open it and supplies its own
 * `HotkeyScopeBoundary` wrap and `htmlSandbox` string. Branches on `fileName`
 * using the `@humanlayer/ui/lib/file-types` helpers — `<img>` for images,
 * `<iframe>` for HTML/PDF (HTML gets the app-supplied sandbox, PDF gets none).
 */
export function ArtifactFullscreenModal({
  open,
  onOpenChange,
  fileName,
  url,
  iframeRenderKey,
  htmlSandbox,
}: ArtifactFullscreenModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[95vw] !w-[95vw] !h-[95vh] !p-2 !gap-0 overflow-hidden flex items-center justify-center">
        {isImageFile(fileName) ? (
          <img src={url} alt={fileName} className="max-w-full max-h-full object-contain" />
        ) : (
          <iframe
            key={iframeRenderKey}
            src={url}
            title={fileName}
            className="w-full h-full border-0"
            sandbox={isHtmlFile(fileName) ? htmlSandbox : undefined}
            tabIndex={-1}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
