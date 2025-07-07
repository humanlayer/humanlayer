import { useState } from 'react'
import { useApprovalsWithSubscription, useDaemonConnection } from '@/hooks'
import { ApprovalType } from '@/lib/daemon'
import { formatTimestamp } from '@/utils/formatting'
import type { UnifiedApprovalRequest } from '@/types/ui'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Loader2, AlertCircle, CheckCircle2, XCircle, MessageSquare } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { notificationService } from '@/services/NotificationService'

/**
 * Example approvals panel component similar to the TUI
 * Shows how to use the hooks and handle real-time updates
 */
export function ApprovalsPanel() {
  const { connected, error: connectionError } = useDaemonConnection()
  const { approvals, loading, error, approve, deny, respond } = useApprovalsWithSubscription()
  const [processingId, setProcessingId] = useState<string | null>(null)

  if (!connected) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Disconnected</AlertTitle>
        <AlertDescription>{connectionError || 'Cannot connect to daemon'}</AlertDescription>
      </Alert>
    )
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Approvals...
          </CardTitle>
        </CardHeader>
      </Card>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }

  const handleApprove = async (approval: UnifiedApprovalRequest) => {
    setProcessingId(approval.id)
    try {
      await approve(approval.callId)
    } catch (err) {
      notificationService.notifyError(err, 'Failed to approve')
    } finally {
      setProcessingId(null)
    }
  }

  const handleDeny = async (approval: UnifiedApprovalRequest) => {
    const reason = prompt('Reason for denial:')
    if (!reason) return

    setProcessingId(approval.id)
    try {
      await deny(approval.callId, reason)
    } catch (err) {
      notificationService.notifyError(err, 'Failed to deny')
    } finally {
      setProcessingId(null)
    }
  }

  const handleRespond = async (approval: UnifiedApprovalRequest) => {
    const response = prompt('Your response:')
    if (!response) return

    setProcessingId(approval.id)
    try {
      await respond(approval.callId, response)
    } catch (err) {
      notificationService.notifyError(err, 'Failed to respond')
    } finally {
      setProcessingId(null)
    }
  }

  if (approvals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No Pending Approvals</CardTitle>
          <CardDescription>Waiting for approval requests...</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Pending Approvals ({approvals.length})</h2>
      <div className="space-y-4">
        {approvals.map(approval => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            isProcessing={processingId === approval.id}
            onApprove={() => handleApprove(approval)}
            onDeny={() => handleDeny(approval)}
            onRespond={() => handleRespond(approval)}
          />
        ))}
      </div>
    </div>
  )
}

interface ApprovalCardProps {
  approval: UnifiedApprovalRequest
  isProcessing: boolean
  onApprove: () => void
  onDeny: () => void
  onRespond: () => void
}

function ApprovalCard({ approval, isProcessing, onApprove, onDeny, onRespond }: ApprovalCardProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Card className={isProcessing ? 'opacity-60' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{approval.title}</CardTitle>
            {approval.sessionQuery && (
              <CardDescription>
                Session: {approval.sessionQuery} • Model: {approval.sessionModel}
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={approval.type === ApprovalType.FunctionCall ? 'default' : 'secondary'}>
              {approval.type === ApprovalType.FunctionCall ? 'Function' : 'Human'}
            </Badge>
            <span className="text-sm text-muted-foreground">{formatTimestamp(approval.createdAt)}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {approval.type === ApprovalType.FunctionCall && approval.parameters && (
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-between">
                View Parameters
                <span className="text-xs">{isOpen ? '▲' : '▼'}</span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <pre className="p-3 bg-muted rounded-md text-sm overflow-x-auto">
                {JSON.stringify(approval.parameters, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}

        {approval.type === ApprovalType.HumanContact && (
          <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-md">
            <p className="text-sm">{approval.description}</p>
          </div>
        )}

        <div className="flex gap-2">
          {approval.type === ApprovalType.FunctionCall ? (
            <>
              <Button onClick={onApprove} disabled={isProcessing} size="sm" className="flex-1">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Approve
              </Button>
              <Button
                onClick={onDeny}
                disabled={isProcessing}
                variant="destructive"
                size="sm"
                className="flex-1"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Deny
              </Button>
            </>
          ) : (
            <Button onClick={onRespond} disabled={isProcessing} size="sm" className="w-full">
              <MessageSquare className="w-4 h-4 mr-2" />
              Respond
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
