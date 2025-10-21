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
  return toast.success(title, {
    id: toastId,
    description,
    duration: 30000, // 30 seconds before auto-dismiss
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
          onClick: async () => {
            try {
              await onUndo()
            } catch (error) {
              toast.error('Failed to undo operation', {
                description: error instanceof Error ? error.message : 'Unknown error',
              })
            }
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
      typeof t.id === 'string' && (t.id.includes('archive_undo') || t.id.includes('draft_delete_undo')),
  )
}
