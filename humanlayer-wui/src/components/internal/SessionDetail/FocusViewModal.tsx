import React from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Expand } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { MarkdownRenderer } from './MarkdownRenderer'

interface FocusViewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  content: string
}

export function FocusViewModal({ open, onOpenChange, content }: FocusViewModalProps) {
  const previousFocusRef = React.useRef<HTMLElement | null>(null)
  const previousScrollTopRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!open) return

    previousFocusRef.current = document.activeElement as HTMLElement
    const conversationContainer = document.querySelector('[data-conversation-container]')
    previousScrollTopRef.current =
      conversationContainer instanceof HTMLElement ? conversationContainer.scrollTop : null
  }, [open])

  const handleClose = React.useCallback(() => {
    onOpenChange(false)

    setTimeout(() => {
      const conversationContainer = document.querySelector('[data-conversation-container]')
      if (conversationContainer instanceof HTMLElement && previousScrollTopRef.current !== null) {
        conversationContainer.scrollTop = previousScrollTopRef.current
      }

      previousFocusRef.current?.focus?.()
    }, 0)
  }, [onOpenChange])

  useHotkeys(
    'escape',
    ev => {
      ev.preventDefault()
      ev.stopPropagation()
      ev.stopImmediatePropagation()
      handleClose()
    },
    {
      enabled: open,
      scopes: [HOTKEY_SCOPES.FOCUS_VIEW_MODAL],
      preventDefault: true,
      enableOnFormTags: true,
    },
  )

  if (!open) return null

  return (
    <HotkeyScopeBoundary
      scope={HOTKEY_SCOPES.FOCUS_VIEW_MODAL}
      isActive={open}
      rootScopeDisabled={true}
      componentName="FocusViewModal"
    >
      <Dialog
        open={open}
        onOpenChange={isOpen => {
          if (!isOpen) {
            handleClose()
          } else {
            onOpenChange(true)
          }
        }}
      >
        <DialogContent
          className="w-screen max-w-none h-screen p-0 sm:max-w-none rounded-none border-0 flex flex-col overflow-hidden"
          onEscapeKeyDown={e => {
            e.preventDefault()
          }}
        >
          <DialogHeader className="px-4 py-3 border-b bg-background flex-none">
            <DialogTitle className="text-sm font-mono flex items-center gap-2">
              <Expand className="h-3.5 w-3.5 text-accent" />
              Focus View
            </DialogTitle>
            <DialogDescription className="sr-only">
              Distraction-free view of the assistant response.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 min-h-0">
            <div className="mx-auto max-w-4xl px-6 py-6">
              <MarkdownRenderer content={content} />
            </div>
          </ScrollArea>

          <div className="px-4 py-2 border-t bg-muted/30 flex justify-end items-center flex-none">
            <span className="text-xs text-muted-foreground">
              <kbd>ESC</kbd> to close
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </HotkeyScopeBoundary>
  )
}
