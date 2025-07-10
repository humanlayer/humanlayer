import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  message?: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}

export function EmptyState({ icon: Icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 px-4 text-center", className)}>
      {Icon && (
        <Icon className="h-12 w-12 text-muted-foreground mb-4" />
      )}
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      {message && (
        <p className="text-sm text-muted-foreground mb-4 max-w-md">{message}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="text-sm text-primary hover:underline focus:outline-none focus:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}