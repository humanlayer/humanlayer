import { FC } from 'react'
import { cn } from '@/lib/utils'

interface AutoAcceptIndicatorProps {
  enabled: boolean
  className?: string
}

export const AutoAcceptIndicator: FC<AutoAcceptIndicatorProps> = ({ enabled, className }) => {
  if (!enabled) return null

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5',
        'text-sm font-medium',
        'bg-[var(--terminal-warning)]/15',
        'text-[var(--terminal-warning)]',
        'border border-[var(--terminal-warning)]/30',
        'rounded-md',
        'animate-pulse-warning',
        className,
      )}
    >
      <span className="text-base leading-none">⏵⏵</span>
      <span>auto-accept edits on (shift+tab to cycle)</span>
    </div>
  )
}
