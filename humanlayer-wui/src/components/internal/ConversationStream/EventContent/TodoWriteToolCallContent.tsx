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

  isFocused,
}: ToolCallContentProps<TodoWriteToolInput>) {
  const getTaskCounts = () => {
    const completed = toolInput.todos.filter(t => t.status === 'completed').length
    const inProgress = toolInput.todos.filter(t => t.status === 'in_progress').length
    const pending = toolInput.todos.filter(t => t.status === 'pending').length
    const total = toolInput.todos.length

    return { completed, inProgress, pending, total }
  }

  const getCurrentTask = () => {
    return toolInput.todos.find(t => t.status === 'in_progress')
  }

  const counts = getTaskCounts()
  const currentTask = getCurrentTask()

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
          nameColor={getApprovalStatusColor(approvalStatus)}
        />
        <div className="ml-4">
          <StatusBadge status={approvalStatus} />
        </div>
      </div>

      {!isFocused && counts.inProgress > 0 && currentTask && (
        <div className="text-xs text-muted-foreground ml-4">
          <Clock className="inline-block w-3 h-3 mr-1" />
          {currentTask.activeForm}
        </div>
      )}

      {isFocused && (
        <div className="ml-4 mt-1 space-y-1">
          {toolInput.todos.map((todo, index) => (
            <div
              key={index}
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
          ))}
        </div>
      )}

      {!isFocused && counts.total > 3 && (
        <div className="text-xs text-gray-400 dark:text-gray-500 ml-4">
          Press <kbd>i</kbd> to view all {counts.total} tasks
        </div>
      )}
    </div>
  )
}
