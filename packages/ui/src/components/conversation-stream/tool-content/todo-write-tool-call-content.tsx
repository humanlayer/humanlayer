import { CheckCircle2, Circle, Clock } from 'lucide-react'
import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { TodoItem, TodoWriteToolInput, ToolCallContentProps } from '../types'
import { getApprovalStatusColor } from '../utils/formatters'

export const TodoWriteToolCallContent: FC<ToolCallContentProps<TodoWriteToolInput>> = ({
	toolInput,
	approvalStatus,
	isGroupItem,
}) => {
	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	const getTaskCounts = () => {
		const todos = Array.isArray(toolInput.todos) ? toolInput.todos : []
		const completed = todos.filter((t) => t.status === 'completed').length
		const inProgress = todos.filter((t) => t.status === 'in_progress').length
		const pending = todos.filter((t) => t.status === 'pending').length
		const total = todos.length

		return { completed, inProgress, pending, total }
	}

	const getWindowedTodos = () => {
		const todos = Array.isArray(toolInput.todos) ? toolInput.todos : []
		const totalCount = todos.length

		if (totalCount === 0) {
			return { windowedTodos: [], windowStart: 0, windowEnd: 0 }
		}

		if (totalCount <= 5) {
			return { windowedTodos: todos, windowStart: 0, windowEnd: totalCount }
		}

		let focusIndex = -1

		focusIndex = todos.findIndex((t) => t.status === 'in_progress')

		if (focusIndex === -1) {
			for (let i = todos.length - 1; i >= 0; i--) {
				const todo = todos[i]
				if (todo && todo.status === 'completed') {
					focusIndex = i
					break
				}
			}
		}

		if (focusIndex === -1) {
			return {
				windowedTodos: todos.slice(0, 5),
				windowStart: 0,
				windowEnd: 5,
			}
		}

		const idealStart = focusIndex - 2
		const start = Math.max(0, Math.min(idealStart, totalCount - 5))

		return {
			windowedTodos: todos.slice(start, start + 5),
			windowStart: start,
			windowEnd: Math.min(start + 5, totalCount),
			focusIndexInWindow: focusIndex - start,
		}
	}

	const counts = getTaskCounts()
	const todos = Array.isArray(toolInput.todos) ? toolInput.todos : []
	const currentTask = todos.find((t) => t && t.status === 'in_progress')

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
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>Update TODOs</span>
						<span className="text-sm text-muted-foreground">
							{counts.completed} completed, {counts.pending} pending
						</span>
					</div>
					{currentTask && (
						<div className="mt-1 font-mono text-sm text-muted-foreground">{currentTask.activeForm}</div>
					)}
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			<div className="ml-4 mt-1 space-y-1">
				{(() => {
					const { windowedTodos, windowStart } = getWindowedTodos()
					return windowedTodos.map((todo, index) => (
						<div
							key={windowStart + index}
							className={`text-sm flex items-start gap-1 ${
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

			{(() => {
				const { windowStart, windowEnd } = getWindowedTodos()
				const todos = Array.isArray(toolInput.todos) ? toolInput.todos : []
				const totalCount = todos.length
				return totalCount > 5 ? (
					<div className="text-sm text-muted-foreground ml-4">
						Showing {windowStart + 1}-{windowEnd} of {totalCount} • Press <kbd>i</kbd> to view all
					</div>
				) : null
			})()}
		</div>
	)
}
