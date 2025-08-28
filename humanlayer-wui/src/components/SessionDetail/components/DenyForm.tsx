import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hasContent } from '@/utils/validation'
import { DataTransformErrorBoundary } from '@/components/ui/DataTransformErrorBoundary'
import { useStore } from '@/AppStore'

// TODO(3): Add validation for minimum reason length
// TODO(3): Consider adding a preset list of common denial reasons

export function DenyForm({
  approvalId,
  onDeny,
  onCancel,
}: {
  approvalId: string
  onDeny?: (approvalId: string, reason: string) => void
  onCancel?: () => void
}) {
  // Use Zustand store for form state
  const setApprovalDenialReason = useStore(state => state.setApprovalDenialReason)
  const setApprovalDenying = useStore(state => state.setApprovalDenying)
  const getApprovalDenial = useStore(state => state.getApprovalDenial)
  const clearApprovalDenial = useStore(state => state.clearApprovalDenial)

  // Get form state from store
  const { reason, isDenying } = getApprovalDenial(approvalId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hasContent(reason) && onDeny && !isDenying) {
      try {
        setApprovalDenying(approvalId, true)
        onDeny(approvalId, reason.trim())
        // Clear form after successful submission
        clearApprovalDenial(approvalId)
      } finally {
        setApprovalDenying(approvalId, false)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit(e as any)
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
      // Clear form when cancelling
      clearApprovalDenial(approvalId)
      onCancel()
    }
  }

  return (
    <DataTransformErrorBoundary
      dataContext="approval denial form"
      expectedDataType="DenyFormData"
      contextInfo={{ approvalId, isDenying, hasReason: hasContent(reason) }}
      critical={true}
    >
      <form onSubmit={handleSubmit} className="flex gap-2 items-center">
        <Input
          type="text"
          placeholder="Reason for denial..."
          value={reason}
          onChange={e => setApprovalDenialReason(approvalId, e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1"
          autoFocus
        />
        <Button
          className="cursor-pointer"
          type="submit"
          size="sm"
          variant="destructive"
          disabled={!hasContent(reason) || isDenying}
        >
          {isDenying ? 'Denying...' : 'Deny'}{' '}
          {hasContent(reason) && !isDenying && (
            <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">⏎</kbd>
          )}
        </Button>
        <Button
          className="cursor-pointer"
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            clearApprovalDenial(approvalId)
            onCancel?.()
          }}
          disabled={isDenying}
        >
          Cancel <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Esc</kbd>
        </Button>
      </form>
    </DataTransformErrorBoundary>
  )
}
