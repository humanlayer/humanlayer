import React from 'react'
import { Button } from '@/components/ui/button'
import { ConversationEvent } from '@/lib/daemon/types'
import { DenyButtons } from '../../SessionDetail/components/DenyButtons'

interface ApprovalWrapperProps {
  children: React.ReactNode
  event: ConversationEvent
  approvalStatus?: 'pending' | 'approved' | 'denied' | 'resolved'
  onApprove?: () => void
  onDeny?: (reason: string) => void
  isApproving?: boolean
  isDenying?: boolean
  confirmingApprovalId?: string | null
  responseText?: string
  onStartDeny?: () => void
  onCancelDeny?: () => void
}

export function ApprovalWrapper({
  children,
  event,
  approvalStatus,
  onApprove,
  onDeny,
  isApproving,
  isDenying,
  confirmingApprovalId,
  responseText,
  onStartDeny,
  onCancelDeny,
}: ApprovalWrapperProps) {
  const needsApproval = approvalStatus === 'pending'
  const showApprovalUI = needsApproval && event.approvalId && onApprove && onDeny

  return (
    <div>
      {children}

      {/* Show approval/deny buttons for pending approvals */}
      {showApprovalUI && (
        <div className="mt-4 flex gap-2 justify-start">
          {!isDenying ? (
            <>
              <Button
                className="cursor-pointer"
                size="sm"
                variant={isApproving ? 'outline' : 'default'}
                onClick={e => {
                  e.stopPropagation()
                  onApprove()
                }}
                disabled={isApproving}
              >
                {isApproving
                  ? 'Approving...'
                  : confirmingApprovalId === event.approvalId
                    ? 'Approve?'
                    : 'Approve'}{' '}
                <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">A</kbd>
              </Button>
              {!isApproving && (
                <Button
                  className="cursor-pointer"
                  size="sm"
                  variant="destructive"
                  onMouseDown={e => {
                    // Prevent the button from stealing focus
                    // This is the recommended pattern for toolbar buttons in contenteditable editors
                    e.preventDefault()
                  }}
                  onClick={e => {
                    e.stopPropagation()
                    onStartDeny?.()
                  }}
                >
                  Deny <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">D</kbd>
                </Button>
              )}
            </>
          ) : (
            <DenyButtons
              onCancel={onCancelDeny}
              onDeny={() => {
                if (event.approvalId && onDeny) {
                  onDeny(responseText?.trim() || '')
                }
              }}
              isDenying={isDenying}
              isDisabled={!responseText?.trim()}
            />
          )}
        </div>
      )}
    </div>
  )
}
