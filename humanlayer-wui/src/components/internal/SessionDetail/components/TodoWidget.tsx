import { ConversationEvent } from '@/lib/daemon/types'
import { CheckCircle, CircleDashed, Hourglass } from 'lucide-react'

// TODO(2): Consider extracting priority and status constants to shared types
// TODO(3): Add animations for status changes

export function TodoWidget({ event }: { event: ConversationEvent }) {
  const toolInput = JSON.parse(event.toolInputJson!)
  const todos = toolInput.todos
  const completedCount = todos.filter((todo: any) => todo.status === 'completed').length
  const pendingCount = todos.filter((todo: any) => todo.status === 'pending').length
  const iconClasses = 'w-3 h-3 align-middle relative top-[1px]'
  const statusToIcon = {
    in_progress: <Hourglass className={iconClasses + ' text-[var(--terminal-warning)]'} />,
    pending: <CircleDashed className={iconClasses + ' text-[var(--terminal-fg-dim)]'} />,
    completed: <CheckCircle className={iconClasses + ' text-[var(--terminal-success)]'} />,
  }

  return (
    <div className="flex flex-col h-full">
      <hgroup className="flex flex-col gap-1 mb-2 flex-shrink-0">
        <h2 className="text-md font-bold text-muted-foreground">TODOs</h2>
        <small>
          {completedCount} completed, {pendingCount} pending
        </small>
      </hgroup>
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        <ul className="text-sm space-y-2">
          {todos.map((todo: any, index: number) => (
            <li key={todo.id ?? index} className="flex gap-2 items-start">
              <span className="flex-shrink-0 mt-0.5">
                {statusToIcon[todo.status as keyof typeof statusToIcon]}
              </span>
              <span className="whitespace-pre-line font-mono break-words">{todo.content}</span>
            </li>
          ))}
        </ul>
        {todos.length === 0 && <div className="text-muted-foreground text-sm">No tasks yet</div>}
      </div>
    </div>
  )
}
