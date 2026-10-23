import { Button } from '@humanlayer/ui/components/button'
import { AlertCircle, Loader2 } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

export interface SlashCommand {
  name: string
  source: 'local' | 'global' | 'bundled'
  description?: string
  /** Text to insert when selected (defaults to name). Used for aliases. */
  insertText?: string
  /**
   * Only offer this command when the slash is the first character of the message.
   * Set it for commands the agent reads itself rather than as prompt text, such as
   * `/compact` and `/clear`: those are parsed at the start of a message only, so
   * offering them mid-sentence would insert something that quietly does nothing.
   */
  startOfMessageOnly?: boolean
}

export interface SlashCommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

export interface SlashCommandListProps {
  commands: SlashCommand[]
  isLoading?: boolean
  error?: string | null
  onSelect: (command: SlashCommand) => void
  /** Show hint that other skills may be available but not in autocomplete */
  showSkillsHint?: boolean
}

export const SlashCommandList = forwardRef<SlashCommandListRef, SlashCommandListProps>(
  ({ commands, isLoading = false, error = null, onSelect, showSkillsHint = false }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0)
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
    const mouseEnabledRef = useRef(true)

    // Scroll selected item into view
    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'auto',
      })
    }, [selectedIndex])

    // Reset selection when results change (use length to avoid resetting on every render)
    // We compare by length since the commands are filtered - same length means same results
    const commandsLength = commands.length
    useEffect(() => {
      setSelectedIndex(0)
    }, [commandsLength])

    // Keyboard navigation
    const onKeyDown = useCallback(
      ({ event }: { event: KeyboardEvent }) => {
        if (commands.length === 0) {
          return false
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault()
          mouseEnabledRef.current = false
          setSelectedIndex((prev) => {
            const newIndex = prev - 1
            return newIndex < 0 ? commands.length - 1 : newIndex
          })
          return true
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault()
          mouseEnabledRef.current = false
          setSelectedIndex((prev) => {
            const newIndex = prev + 1
            return newIndex >= commands.length ? 0 : newIndex
          })
          return true
        }

        if (event.key === 'Tab') {
          event.preventDefault()
          mouseEnabledRef.current = false
          if (event.shiftKey) {
            setSelectedIndex((prev) => {
              const newIndex = prev - 1
              return newIndex < 0 ? commands.length - 1 : newIndex
            })
          } else {
            setSelectedIndex((prev) => {
              const newIndex = prev + 1
              return newIndex >= commands.length ? 0 : newIndex
            })
          }
          return true
        }

        if (event.key === 'Enter') {
          // Safe to take Enter: the menu is only open when the query prefix-matches a real
          // command (see matchSlashCommands), so there is something to pick. An unmatched
          // query leaves `commands` empty and returns above, so Enter still inserts a break.
          event.preventDefault()
          const safeIndex = Math.min(selectedIndex, commands.length - 1)
          if (safeIndex >= 0) {
            const command = commands[safeIndex]
            if (command !== undefined) onSelect(command)
          }
          return true
        }

        if (event.key === ' ' || event.key === 'Escape') {
          return false
        }

        return false
      },
      [commands, selectedIndex, onSelect],
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
      return (
        <div className="p-1">
          <div className="px-2 py-1.5 text-xs text-muted-foreground">no commands found</div>
          {showSkillsHint && (
            <div className="px-1.5 py-1.5 text-xs text-muted-foreground border-t border-border">
              skills the agent has not reported yet are still accepted
            </div>
          )}
        </div>
      )
    }

    // Render command list
    return (
      <div className="p-1">
        {/* Rows share the columns through subgrid so descriptions line up across commands */}
        <div className="grid max-h-[360px] grid-cols-[minmax(0,max-content)_minmax(0,1fr)_max-content] overflow-y-auto">
          {commands.map((cmd, index) => (
            <Button
              key={cmd.name}
              ref={(el) => {
                itemRefs.current[index] = el
              }}
              variant="ghost"
              size="sm"
              tabIndex={-1}
              className={`col-span-full grid grid-cols-subgrid items-center gap-x-3 px-2 py-1 normal-case focus-visible:ring-0 focus-visible:border-transparent focus:ring-0 focus:outline-none hover:bg-transparent ${
                index === selectedIndex
                  ? 'bg-accent/20 ring-1 ring-inset ring-accent'
                  : ''
              }`}
              onMouseEnter={() => {
                if (mouseEnabledRef.current) {
                  setSelectedIndex(index)
                }
              }}
              onMouseMove={() => {
                mouseEnabledRef.current = true
              }}
              onClick={() => {
                onSelect(cmd)
              }}
            >
              <span className="max-w-[360px] truncate text-left">{cmd.name}</span>
              <span className="truncate text-left text-xs text-muted-foreground">{cmd.description}</span>
              <span className="justify-self-end px-1.5 py-0.5 text-[10px] text-muted-foreground bg-muted normal-case">
                {cmd.source}
              </span>
            </Button>
          ))}
        </div>
        {showSkillsHint && (
          <div className="px-1.5 py-1.5 text-xs text-muted-foreground border-t border-border">
            skills the agent has not reported yet are still accepted
          </div>
        )}
      </div>
    )
  },
)

SlashCommandList.displayName = 'SlashCommandList'
