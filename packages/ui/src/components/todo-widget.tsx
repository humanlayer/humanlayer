import { CheckCircle, CircleDashed, Clock } from 'lucide-react'
import { cn } from '@humanlayer/ui/lib/utils'
import type { FC } from 'react'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface Todo {
  id?: string
  content: string
  status: TodoStatus
  activeForm?: string
}

export interface TodoWidgetProps {
  todos: Todo[]
  className?: string
}

const iconClasses = 'w-3 h-3 align-middle relative top-[1px]'

const statusToIcon: Record<TodoStatus, React.ReactNode> = {
  in_progress: <Clock className={cn(iconClasses, 'text-[var(--terminal-warning)]')} />,
  pending: <CircleDashed className={cn(iconClasses, 'text-[var(--terminal-fg-dim)]')} />,
  completed: <CheckCircle className={cn(iconClasses, 'text-[var(--terminal-success)]')} />,
}

export const TodoWidget: FC<TodoWidgetProps> = ({ todos, className }) => {
  const completedCount = todos.filter((todo) => todo.status === 'completed').length
  const pendingCount = todos.filter((todo) => todo.status === 'pending').length

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <hgroup className="flex flex-col gap-1 mb-2 flex-shrink-0">
        <h2 className="text-md font-bold text-muted-foreground">TODOs</h2>
        <small>
          {completedCount} completed, {pendingCount} pending
        </small>
      </hgroup>
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        <ul className="text-sm space-y-2">
          {todos.map((todo, index) => (
            <li key={todo.id ?? index} className="flex gap-2 items-start">
              <span className="flex-shrink-0 mt-0.5">{statusToIcon[todo.status]}</span>
              <span className="whitespace-pre-line font-mono break-words">{todo.content}</span>
            </li>
          ))}
        </ul>
        {todos.length === 0 && <div className="text-muted-foreground text-sm">No tasks yet</div>}
      </div>
    </div>
  )
}
