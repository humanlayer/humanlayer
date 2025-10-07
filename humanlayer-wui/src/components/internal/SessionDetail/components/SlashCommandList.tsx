import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { Editor } from '@tiptap/react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'
import { daemonClient } from '@/lib/daemon/client'

interface SlashCommandListProps {
  query: string
  command: (item: { id: string; label: string }) => void
  editor: Editor
}

interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface SlashCommand {
  name: string
  source: 'local' | 'global'
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>(
  ({ query, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [commands, setCommands] = useState<SlashCommand[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const activeSessionDetail = useStore(state => state.activeSessionDetail)

    // Fetch commands from daemon
    useEffect(() => {
      if (!activeSessionDetail?.session?.id) {
        // No active session - treat as empty state, not error
        setCommands([])
        setError(null)
        return
      }

      const fetchCommands = async () => {
        setIsLoading(true)
        setError(null)

        try {
          // Call the getSlashCommands method directly on the client
          const response = await daemonClient.getSlashCommands({
            sessionId: activeSessionDetail.session.id,
            query: query || '/',
          })

          setCommands(response.data || [])
          // Clear any previous errors on successful fetch
          setError(null)
        } catch (err) {
          logger.error('Failed to fetch slash commands:', err)
          setError('Failed to load commands')
          setCommands([])
        } finally {
          setIsLoading(false)
        }
      }

      fetchCommands()
    }, [query, activeSessionDetail?.session?.id])

    // Reset selection when results change
    useEffect(() => {
      setSelectedIndex(0)
    }, [commands])

    // Keyboard navigation
    const onKeyDown = useCallback(
      ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedIndex(prev => (prev - 1 + commands.length) % commands.length || 0)
          return true
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedIndex(prev => (prev + 1) % commands.length)
          return true
        }

        if (event.key === 'Tab') {
          event.preventDefault()
          if (event.shiftKey) {
            setSelectedIndex(prev => (prev - 1 + commands.length) % commands.length || 0)
          } else {
            setSelectedIndex(prev => (prev + 1) % commands.length)
          }
          return true
        }

        if (event.key === 'Enter') {
          event.preventDefault()
          if (commands.length > 0) {
            const selected = commands[selectedIndex]
            // Pass the full command with slash - Tiptap will replace the trigger /
            command({ id: selected.name, label: selected.name })
          }
          return true
        }

        if (event.key === ' ') {
          // Space closes dropdown, leaves raw text
          return false
        }

        if (event.key === 'Escape') {
          return false
        }

        return false
      },
      [commands, selectedIndex, command],
    )

    // Expose keyboard handler via ref
    useImperativeHandle(ref, () => ({
      onKeyDown,
    }))

    // Render loading state
    if (isLoading) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading commands...</span>
        </div>
      )
    }

    // Render error state
    if (error) {
      return (
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )
    }

    // Render empty state
    if (commands.length === 0) {
      return <div className="px-3 py-2 text-sm text-muted-foreground">No commands found</div>
    }

    // Render command list
    return (
      <div className="p-1">
        <div className="max-h-[360px] overflow-y-auto">
          {commands.map((cmd, index) => (
            <Button
              key={cmd.name}
              variant="ghost"
              size="sm"
              className={`w-full justify-start px-2 py-1 ${
                index === selectedIndex ? 'bg-accent text-accent-foreground' : ''
              }`}
              onMouseEnter={() => setSelectedIndex(index)}
              onClick={() => {
                // Pass the full command with slash - Tiptap will replace the trigger /
                command({ id: cmd.name, label: cmd.name })
              }}
            >
              <span className="flex-1 text-left">{cmd.name}</span>
              <span className="ml-2 px-1.5 py-0.5 text-[10px] text-muted-foreground bg-muted rounded">
                {cmd.source}
              </span>
            </Button>
          ))}
        </div>
      </div>
    )
  },
)

SlashCommandList.displayName = 'SlashCommandList'
