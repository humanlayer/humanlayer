import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { hasContent } from '@/utils/validation'
import { DataTransformErrorBoundary } from '@/components/ui/DataTransformErrorBoundary'

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
  const [reason, setReason] = useState('')
  const [isDenying, setIsDenying] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (hasContent(reason) && onDeny && !isDenying) {
      try {
        setIsDenying(true)
        onDeny(approvalId, reason.trim())
      } finally {
        setIsDenying(false)
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit(e as any)
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault()
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
          onChange={e => setReason(e.target.value)}
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
          onClick={onCancel}
          disabled={isDenying}
        >
          Cancel <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Esc</kbd>
        </Button>
      </form>
    </DataTransformErrorBoundary>
  )
}
