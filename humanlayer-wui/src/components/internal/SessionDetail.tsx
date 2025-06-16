import { SessionInfo } from '@/lib/daemon/types'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { useHotkeys } from 'react-hotkeys-hook'
import { useFormattedConversation } from '@/hooks/useConversation'
import { Skeleton } from '../ui/skeleton'
import { Suspense } from 'react'
import { MessageCircleDashed } from 'lucide-react'

interface SessionDetailProps {
  session: SessionInfo
  onClose: () => void
}

function ConversationContent({ sessionId }: { sessionId: string }) {
  const { formattedEvents, loading, error } = useFormattedConversation(sessionId)

  if (error) {
    return <div className="text-red-500">Error loading conversation: {error}</div>
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  // No events yet.
  if (formattedEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="text-gray-400 mb-2">
          <MessageCircleDashed className="w-12 h-12 mx-auto" />
        </div>
        <h3 className="text-lg font-medium text-gray-900">No conversation yet</h3>
        <p className="mt-1 text-sm text-gray-500">The conversation will appear here once it starts.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {formattedEvents.map(event => (
        <div key={event.id} className="border-b pb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium">{event.role || event.type}</span>
            <span className="text-sm text-gray-500">{event.timestamp.toLocaleTimeString()}</span>
          </div>
          <p className="whitespace-pre-wrap">{event.content}</p>
        </div>
      ))}
    </div>
  )
}

function SessionDetail({ session, onClose }: SessionDetailProps) {
  useHotkeys('escape', onClose)

  console.log('session in detail', session)

  return (
    <section className="flex flex-col gap-4">
      <hgroup className="flex flex-col gap-1">
        <h2 className="text-2xl font-semibold text-gray-900">{session.query} </h2>
        <small className="text-gray-500 font-mono text-sm uppercase">
          {session.status} / {session.id} / {session.model}
        </small>
      </hgroup>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
          </CardHeader>
          <CardContent>
            <Suspense
              fallback={
                <div className="space-y-4">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              }
            >
              <ConversationContent sessionId={session.id} />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

export default SessionDetail
