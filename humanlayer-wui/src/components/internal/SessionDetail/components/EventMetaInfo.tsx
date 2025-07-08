import { ConversationEvent } from '@/lib/daemon/types'
import { formatAbsoluteTimestamp } from '@/utils/formatting'

export function EventMetaInfo({ event }: { event: ConversationEvent }) {
  return (
    <div className="bg-muted/20 rounded p-4 mt-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="font-medium text-muted-foreground">Event ID:</span>
          <span className="ml-2 font-mono">{event.id}</span>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Sequence:</span>
          <span className="ml-2 font-mono">{event.sequence}</span>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Type:</span>
          <span className="ml-2 font-mono">{event.event_type}</span>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Role:</span>
          <span className="ml-2 font-mono">{event.role || 'N/A'}</span>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Created:</span>
          <span className="ml-2 font-mono text-xs">{formatAbsoluteTimestamp(event.created_at)}</span>
        </div>
        <div>
          <span className="font-medium text-muted-foreground">Completed:</span>
          <span className="ml-2">{event.is_completed ? '✓' : '⏳'}</span>
        </div>
        {event.tool_name && (
          <>
            <div>
              <span className="font-medium text-muted-foreground">Tool:</span>
              <span className="ml-2 font-mono">{event.tool_name}</span>
            </div>
            <div>
              <span className="font-medium text-muted-foreground">Tool ID:</span>
              <span className="ml-2 font-mono text-xs">{event.tool_id}</span>
            </div>
          </>
        )}
        {event.approval_status && (
          <div>
            <span className="font-medium text-muted-foreground">Approval:</span>
            <span className="ml-2 font-mono">{event.approval_status}</span>
          </div>
        )}
      </div>

      {event.tool_input_json && (
        <div className="mt-3">
          <span className="font-medium text-muted-foreground">Tool Input:</span>
          <pre className="mt-1 text-xs bg-background rounded p-2 overflow-x-auto">
            {JSON.stringify(JSON.parse(event.tool_input_json), null, 2)}
          </pre>
        </div>
      )}

      {event.tool_result_content && (
        <div className="mt-3">
          <span className="font-medium text-muted-foreground">Tool Result:</span>
          <pre className="mt-1 text-xs bg-background rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
            {event.tool_result_content}
          </pre>
        </div>
      )}
    </div>
  )
}
