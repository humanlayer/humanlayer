import { CheckCircle2, Circle, Clock } from 'lucide-react'
import { ToolCallContentProps } from './types'
import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { getApprovalStatusColor } from './utils/formatters'

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}

interface TodoWriteToolInput {
  todos: TodoItem[]
}

export function TodoWriteToolCallContent({
  toolInput,
  approvalStatus,
  isGroupItem,
}: ToolCallContentProps<TodoWriteToolInput>) {
  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  const getTaskCounts = () => {
    const completed = toolInput.todos.filter(t => t.status === 'completed').length
    const inProgress = toolInput.todos.filter(t => t.status === 'in_progress').length
    const pending = toolInput.todos.filter(t => t.status === 'pending').length
    const total = toolInput.todos.length

    return { completed, inProgress, pending, total }
  }

  const getWindowedTodos = () => {
    const todos = toolInput.todos
    const totalCount = todos.length

    // Handle empty list
    if (totalCount === 0) {
      return { windowedTodos: [], windowStart: 0, windowEnd: 0 }
    }

    // If 5 or fewer todos, show all
    if (totalCount <= 5) {
      return { windowedTodos: todos, windowStart: 0, windowEnd: totalCount }
    }

    // Find the focus todo based on priority
    let focusIndex = -1

    // Priority 1: in_progress task
    focusIndex = todos.findIndex(t => t.status === 'in_progress')

    // Priority 2: last completed task
    if (focusIndex === -1) {
      for (let i = todos.length - 1; i >= 0; i--) {
        if (todos[i].status === 'completed') {
          focusIndex = i
          break
        }
      }
    }

    // Priority 3: all pending - no centering, show from top
    if (focusIndex === -1) {
      return {
        windowedTodos: todos.slice(0, 5),
        windowStart: 0,
        windowEnd: 5,
      }
    }

    // Calculate ideal window with focus todo at position 2 (0-indexed)
    let idealStart = focusIndex - 2

    // Constrain window to valid bounds
    let start = Math.max(0, Math.min(idealStart, totalCount - 5))

    return {
      windowedTodos: todos.slice(start, start + 5),
      windowStart: start,
      windowEnd: Math.min(start + 5, totalCount),
      focusIndexInWindow: focusIndex - start,
    }
  }

  const counts = getTaskCounts()
  const currentTask = toolInput.todos.find(t => t.status === 'in_progress')

  const getTaskIcon = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="w-3 h-3 text-[var(--terminal-success)]" />
      case 'in_progress':
        return <Clock className="w-3 h-3 text-[var(--terminal-warning)]" />
      case 'pending':
        return <Circle className="w-3 h-3 text-[var(--terminal-fg-dim)]" />
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start justify-between w-full">
        <ToolHeader
          name="Update TODOs"
          description={`${counts.completed} completed, ${counts.pending} pending`}
          primaryParam={currentTask ? currentTask.activeForm : undefined}
          nameColor={statusColor}
        />
        <div className="ml-4">
          <StatusBadge status={approvalStatus} />
        </div>
      </div>

      {/* Always show windowed todos */}
      <div className="ml-4 mt-1 space-y-1">
        {(() => {
          const { windowedTodos, windowStart } = getWindowedTodos()
          return windowedTodos.map((todo, index) => (
            <div
              key={windowStart + index}
              className={`text-xs flex items-start gap-1 ${
                todo.status === 'completed'
                  ? 'text-muted-foreground opacity-60'
                  : todo.status === 'in_progress'
                    ? 'text-foreground'
                    : 'text-muted-foreground'
              }`}
            >
              {getTaskIcon(todo.status)}
              <span className={todo.status === 'completed' ? 'line-through' : ''}>{todo.content}</span>
            </div>
          ))
        })()}
      </div>

      {/* Show count indicator if not all todos are visible */}
      {(() => {
        const { windowStart, windowEnd } = getWindowedTodos()
        const totalCount = toolInput.todos.length
        return totalCount > 5 ? (
          <div className="text-xs text-gray-400 dark:text-gray-500 ml-4">
            Showing {windowStart + 1}-{windowEnd} of {totalCount} • Press <kbd>i</kbd> to view all
          </div>
        ) : null
      })()}
    </div>
  )
}
