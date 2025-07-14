import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from './ui/input'
import { useHotkeys } from 'react-hotkeys-hook'
import { SessionTableHotkeysScope } from './internal/SessionTable'
import { Badge } from './ui/badge'
import { useStore } from '@/AppStore'
import { ViewMode } from '@/lib/daemon/types'

interface SessionTableSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  statusFilter?: string | null
  onEscape?: () => void
}

export function SessionTableSearch({
  value,
  onChange,
  placeholder = 'Search sessions...',
  className,
  statusFilter,
}: SessionTableSearchProps) {
  const inputClassId = 'session-table-search-input'
  const viewMode = useStore(state => state.viewMode)
  const selectedSessions = useStore(state => state.selectedSessions)
  const clearSelection = useStore(state => state.clearSelection)

  // For unknown reasons, I can't seem to detect a 'slash' character here. This is the silliest.
  // But maybe we're all the silliest and this continues a long and highly venerated tradition of silliness.
  useHotkeys(
    '*',
    e => {
      if (e.key === '/') {
        e.preventDefault()
        e.stopPropagation()
        const input = document.getElementById(inputClassId) as HTMLInputElement
        if (input) {
          input.focus()
          input.select()
        }
      }
    },
    {
      scopes: SessionTableHotkeysScope,
      enabled: true,
    },
  )

  useHotkeys(
    'escape',
    () => {
      const input = document.getElementById(inputClassId) as HTMLInputElement
      if (input) {
        input.blur()
      }
    },
    {
      scopes: SessionTableHotkeysScope,
      enabled: true,
      enableOnFormTags: ['INPUT'],
    },
  )

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 h-4 w-4 text-muted-foreground top-1/2 -translate-y-1/2" />
          <Input
            id={inputClassId}
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(
              'w-full h-9 pl-10 pr-3 text-sm',
              'font-mono',
              'bg-background border rounded-md',
              'transition-all duration-300 ease-in-out',
              'placeholder:text-muted-foreground/60',
              'border-border hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20',
              'focus:outline-none',
            )}
            spellCheck={false}
          />
        </div>

        {selectedSessions.size > 0 && (
          <Badge
            variant="secondary"
            className="text-xs cursor-pointer animate-in fade-in slide-in-from-right-1 duration-200"
            onClick={clearSelection}
          >
            {selectedSessions.size} selected
          </Badge>
        )}

        {viewMode === ViewMode.Archived && (
          <Badge
            variant="secondary"
            className="text-xs animate-in fade-in slide-in-from-right-1 duration-200"
          >
            Archived Sessions
          </Badge>
        )}

        {statusFilter && (
          <span
            className="px-2 py-1 text-xs text-accent-foreground rounded whitespace-nowrap animate-in fade-in slide-in-from-right-1 duration-200"
            style={{ backgroundColor: 'var(--terminal-accent)' }}
          >
            status: {statusFilter.toLowerCase()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground justify-end">
        <span>toggle archived view with</span>
        <kbd className="px-1 py-0.5 text-xs bg-muted rounded">TAB</kbd>
      </div>
    </div>
  )
}
