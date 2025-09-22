import { CheckCircle2, Circle, Clock } from 'lucide-react'
import { ToolCallContentProps } from './types'
import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'

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
  isCompleted,
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
        return <CheckCircle2 className="w-3 h-3 text-green-500" />
      case 'in_progress':
        return <Clock className="w-3 h-3 text-blue-500" />
      case 'pending':
        return <Circle className="w-3 h-3 text-gray-400" />
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start justify-between w-full">
        <ToolHeader
          name="TodoWrite"
          description={`${counts.completed}/${counts.total} completed`}
          primaryParam={currentTask ? currentTask.activeForm : undefined}
        />
        <div className="ml-4">
          <StatusBadge isCompleted={isCompleted} />
        </div>
      </div>

      {!isFocused && counts.inProgress > 0 && currentTask && (
        <div className="text-xs text-blue-600 dark:text-blue-400 ml-4">
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
                  ? 'text-gray-500 dark:text-gray-400'
                  : todo.status === 'in_progress'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-600 dark:text-gray-300'
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
          Press Enter to view all {counts.total} tasks
        </div>
      )}
    </div>
  )
}
