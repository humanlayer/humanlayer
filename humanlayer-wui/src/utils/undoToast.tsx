import React from 'react'
import { toast } from 'sonner'
import { CodeLayerToastButtons } from '@/components/internal/CodeLayerToastButtons'

export interface UndoToastOptions {
  title: string
  description?: string
  toastId: string
  onUndo: () => void | Promise<void>
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info'
}

export function showUndoToast(options: UndoToastOptions) {
  const { title, description, toastId, onUndo, variant = 'default' } = options

  // Clear any existing success/info toasts that might cover this
  const visibleToasts = toast.getToasts ? toast.getToasts() : []
  visibleToasts.forEach(t => {
    // Only dismiss non-action toasts (success/info without undo)
    if (typeof t.id === 'string' && !t.id.includes('undo') && !t.id.includes('approval_required')) {
      toast.dismiss(t.id)
    }
  })

  // Show the undo toast with sticky duration
  // Use default toast (not success) for archiving/discarding operations
  return toast(title, {
    id: toastId,
    description,
    duration: 30000, // 30 seconds before auto-dismiss
    position: 'top-right', // Match CMD+SHIFT+J positioning
    action: (
      <CodeLayerToastButtons
        action={{
          label: (
            <span className="flex items-center gap-1">
              Undo
              <kbd className="ml-1 px-1.5 py-0.5 text-sm font-medium bg-background/50 rounded border border-border">
                Z
              </kbd>
            </span>
          ),
          onClick: async (event?: React.MouseEvent<HTMLButtonElement>) => {
            if (!event) {
              // If no event, just execute the undo without flash
              try {
                await onUndo()
                toast.dismiss(toastId)
              } catch (error) {
                toast.error('Failed to undo operation', {
                  description: error instanceof Error ? error.message : 'Unknown error',
                })
              }
              return
            }

            // Get the button element
            const buttonElement = event.currentTarget as HTMLElement

            // Apply flash effect (100ms)
            buttonElement.classList.add('!bg-[var(--terminal-accent)]', '!text-background')

            // Flash all child elements for proper contrast
            const childElements = buttonElement.querySelectorAll('*')
            childElements.forEach(child => {
              ;(child as HTMLElement).classList.add('!text-background')
            })

            // Remove flash after 100ms
            setTimeout(() => {
              buttonElement.classList.remove('!bg-[var(--terminal-accent)]', '!text-background')
              childElements.forEach(child => {
                ;(child as HTMLElement).classList.remove('!text-background')
              })

              // Wait another 100ms then execute the undo and dismiss
              setTimeout(async () => {
                try {
                  await onUndo()
                  // Dismiss the toast after successful undo
                  toast.dismiss(toastId)
                } catch (error) {
                  toast.error('Failed to undo operation', {
                    description: error instanceof Error ? error.message : 'Unknown error',
                  })
                }
              }, 100)
            }, 100)
          },
        }}
        variant={variant}
        toastId={toastId}
      />
    ),
  })
}

export function getUndoableToasts() {
  const visibleToasts = toast.getToasts ? toast.getToasts() : []
  return visibleToasts.filter(
    t =>
      typeof t.id === 'string' &&
      (t.id.includes('archive_undo') ||
        t.id.includes('draft_delete_undo') ||
        t.id.includes('unarchive_undo') ||
        t.id.includes('bulk_archive_undo') ||
        t.id.includes('bulk_draft_delete_undo') ||
        t.id.includes('bulk_unarchive_undo')),
  )
}
