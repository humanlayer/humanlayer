import { ConversationEvent } from '@/lib/daemon/types'
import { CheckCircle, CircleDashed, Hourglass } from 'lucide-react'

interface TodoItem {
  id: string
  content: string
  priority: 'high' | 'medium' | 'low'
  status: 'in_progress' | 'pending' | 'completed'
}

// TODO(2): Consider extracting priority and status constants to shared types
// TODO(3): Add animations for status changes
// TODO(3): Add collapsible sections for each priority level

export function TodoWidget({ event }: { event: ConversationEvent }) {
  const toolInput = JSON.parse(event.tool_input_json!)
  const priorityGrouped = Object.groupBy(
    toolInput.todos as TodoItem[],
    (todo: TodoItem) => todo.priority,
  )
  const todos = toolInput.todos as TodoItem[]
  const completedCount = todos.filter((todo: TodoItem) => todo.status === 'completed').length
  const pendingCount = todos.filter((todo: TodoItem) => todo.status === 'pending').length
  const displayOrder = ['high', 'medium', 'low']
  const iconClasses = 'w-3 h-3 align-middle relative top-[1px]'
  const statusToIcon = {
    in_progress: <Hourglass className={iconClasses + ' text-[var(--terminal-warning)]'} />,
    pending: <CircleDashed className={iconClasses + ' text-[var(--terminal-fg-dim)]'} />,
    completed: <CheckCircle className={iconClasses + ' text-[var(--terminal-success)]'} />,
  }

  return (
    <div>
      <hgroup className="flex flex-col gap-1 my-2">
        <h2 className="text-md font-bold text-muted-foreground">TODOs</h2>
        <small>
          {completedCount} completed, {pendingCount} pending
        </small>
      </hgroup>
      {displayOrder.map(priority => {
        const todosInPriority = priorityGrouped[priority as 'high' | 'medium' | 'low'] || []
        // Only render the priority section if there are todos in it
        if (todosInPriority.length === 0) return null

        return (
          <div key={priority} className="flex flex-col gap-1 mb-2">
            <h3 className="font-medium text-sm">{priority}</h3>
            <ul className="text-sm">
              {todosInPriority.map((todo: TodoItem) => (
                <li key={todo.id} className="flex gap-2 items-start">
                  <span className="flex-shrink-0 mt-1">
                    {statusToIcon[todo.status as keyof typeof statusToIcon]}
                  </span>
                  <span className="whitespace-pre-line font-mono">{todo.content}</span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
