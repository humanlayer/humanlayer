import React from 'react'
import { Button } from '../ui/button'

interface ToastAction {
  label: string | React.ReactNode
  onClick: (event?: React.MouseEvent<HTMLButtonElement>) => void
}

interface CodeLayerToastButtonsProps {
  action?: ToastAction
  cancel?: ToastAction
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info'
}

/**
 * Wrapper component for toast action buttons that provides consistent layout
 * Use this when you need multiple buttons in a toast with equal width distribution
 *
 * Note: Toast dismissal is handled automatically by sonner when buttons are clicked
 */
export function CodeLayerToastButtons({
  action,
  cancel,
  variant = 'default',
}: CodeLayerToastButtonsProps) {
  const handleCancel = (e: React.MouseEvent<HTMLButtonElement>) => {
    cancel?.onClick?.(e)
  }

  const handleAction = (e: React.MouseEvent<HTMLButtonElement>) => {
    action?.onClick?.(e)
    // Sonner automatically dismisses the toast after action.onClick
    // unless event.preventDefault() is called
  }

  const hasBothButtons = action && cancel

  // Get color classes based on toast variant
  const getButtonColorClasses = () => {
    switch (variant) {
      case 'success':
        return {
          action:
            'bg-background text-[var(--terminal-success)] border-[var(--terminal-success)] hover:bg-[var(--terminal-success)] hover:text-background focus-visible:border-[var(--terminal-success)] focus-visible:ring-[var(--terminal-success)]/50',
          cancel:
            'bg-transparent text-[var(--terminal-success)] border-[var(--terminal-success)] hover:bg-[var(--terminal-success)] hover:text-background focus-visible:border-[var(--terminal-success)] focus-visible:ring-[var(--terminal-success)]/50',
        }
      case 'error':
        return {
          action:
            'bg-background text-[var(--terminal-error)] border-[var(--terminal-error)] hover:bg-[var(--terminal-error)] hover:text-background focus-visible:border-[var(--terminal-error)] focus-visible:ring-[var(--terminal-error)]/50',
          cancel:
            'bg-transparent text-[var(--terminal-error)] border-[var(--terminal-error)] hover:bg-[var(--terminal-error)] hover:text-background focus-visible:border-[var(--terminal-error)] focus-visible:ring-[var(--terminal-error)]/50',
        }
      case 'warning':
        return {
          action:
            'bg-background text-[var(--terminal-warning)] border-[var(--terminal-warning)] hover:bg-[var(--terminal-warning)] hover:text-background focus-visible:border-[var(--terminal-warning)] focus-visible:ring-[var(--terminal-warning)]/50',
          cancel:
            'bg-transparent text-[var(--terminal-warning)] border-[var(--terminal-warning)] hover:bg-[var(--terminal-warning)] hover:text-background focus-visible:border-[var(--terminal-warning)] focus-visible:ring-[var(--terminal-warning)]/50',
        }
      case 'info':
        return {
          action:
            'bg-background text-[var(--terminal-accent)] border-[var(--terminal-accent)] hover:bg-[var(--terminal-accent)] hover:text-background focus-visible:border-[var(--terminal-accent)] focus-visible:ring-[var(--terminal-accent)]/50',
          cancel:
            'bg-transparent text-[var(--terminal-accent)] border-[var(--terminal-accent)] hover:bg-[var(--terminal-accent)] hover:text-background focus-visible:border-[var(--terminal-accent)] focus-visible:ring-[var(--terminal-accent)]/50',
        }
      default:
        return {
          action: '', // Use default Button variant styles
          cancel: '', // Use default Button variant styles
        }
    }
  }

  const colorClasses = getButtonColorClasses()

  return (
    // <div className="flex gap-2 w-full mt-3 -mx-4 px-4 pb-4">
    <div className="flex gap-2 w-full mt-3">
      {cancel && (
        <Button
          data-button
          data-cancel
          onClick={handleCancel}
          variant={variant === 'default' ? 'outline' : undefined}
          size="sm"
          className={`${hasBothButtons ? 'flex-1' : 'w-full'} uppercase ${colorClasses.cancel}`}
        >
          {cancel.label}
        </Button>
      )}
      {action && (
        <Button
          data-button
          data-action
          onClick={handleAction}
          variant={variant === 'default' ? 'default' : undefined}
          size="sm"
          className={`${hasBothButtons ? 'flex-1' : 'w-full'} uppercase ${colorClasses.action}`}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}
