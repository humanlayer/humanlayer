import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp, FolderOpen, Plus, X, Lock } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SessionStatus } from '@/lib/daemon/types'
import { toast } from 'sonner'

interface AdditionalDirectoriesDropdownProps {
  workingDir: string
  directories: string[]
  sessionStatus: SessionStatus
  onDirectoriesChange?: (directories: string[]) => void | Promise<void>
}

export function AdditionalDirectoriesDropdown({
  workingDir,
  directories,
  sessionStatus,
  onDirectoriesChange
}: AdditionalDirectoriesDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [localDirectories, setLocalDirectories] = useState<string[]>(directories)
  const [newDirectory, setNewDirectory] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  // Update local state when prop changes
  useEffect(() => {
    setLocalDirectories(directories)
  }, [directories])

  // Check if editing is allowed based on session status
  const canEdit = sessionStatus === 'completed' || sessionStatus === 'waiting_input'

  const handleAddDirectory = async () => {
    const trimmed = newDirectory.trim()
    if (trimmed && !localDirectories.includes(trimmed)) {
      const updated = [...localDirectories, trimmed]
      setLocalDirectories(updated)
      setIsUpdating(true)
      try {
        // Await the update to ensure it completes before allowing further actions
        await onDirectoriesChange?.(updated)
        setNewDirectory('')
        setIsAdding(false)

        // Show appropriate message based on session status
        if (sessionStatus === 'running' || sessionStatus === 'starting') {
          toast.success('Directory added - will apply at next message')
        } else {
          toast.success('Directory added')
        }
      } catch (error) {
        toast.error('Failed to add directory')
        // Revert the local change on error
        setLocalDirectories(directories)
      } finally {
        setIsUpdating(false)
      }
    }
  }

  const handleRemoveDirectory = async (dirToRemove: string) => {
    const updated = localDirectories.filter(dir => dir !== dirToRemove)
    setLocalDirectories(updated)
    setIsUpdating(true)
    try {
      // Await the update to ensure it completes before allowing further actions
      await onDirectoriesChange?.(updated)

      // Show appropriate message based on session status
      if (sessionStatus === 'running' || sessionStatus === 'starting') {
        toast.success('Directory removed - will apply at next message')
      } else {
        toast.success('Directory removed')
      }
    } catch (error) {
      toast.error('Failed to remove directory')
      // Revert the local change on error
      setLocalDirectories(directories)
    } finally {
      setIsUpdating(false)
    }
  }

  const directoryCount = directories?.length || 0

  const buttonContent = (
    <button
      className={`inline-flex items-center text-xs font-mono transition-colors focus:outline-none ${
        canEdit
          ? 'text-muted-foreground hover:text-foreground cursor-pointer'
          : 'text-muted-foreground/50 cursor-not-allowed'
      }`}
      disabled={!canEdit || isUpdating}
    >
      <span>{workingDir}</span>
      {directoryCount > 0 && (
        <span className="ml-1.5">+{directoryCount} more</span>
      )}
      {!canEdit && <Lock className="h-3 w-3 ml-1" />}
      {isOpen ? (
        <ChevronUp className="h-3 w-3 ml-1" />
      ) : (
        <ChevronDown className="h-3 w-3 ml-1" />
      )}
    </button>
  )

  if (!canEdit) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {buttonContent}
          </TooltipTrigger>
          <TooltipContent
            align="start"
            sideOffset={5}
            className="text-xs"
          >
            Directory changes available when ready for input
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {buttonContent}
      </PopoverTrigger>
      <PopoverContent
        className="w-96 p-3"
        align="start"
        sideOffset={5}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground pb-1 border-b">
            <FolderOpen className="h-3 w-3" />
            <span>Working Directory</span>
          </div>
          <div className="font-mono text-xs text-foreground py-1">
            {workingDir}
          </div>

          <div className="flex items-center justify-between text-xs font-semibold text-foreground pt-2 pb-1 border-b">
            <div className="flex items-center gap-1.5">
              <FolderOpen className="h-3 w-3" />
              <span>Additional Directories</span>
            </div>
            {onDirectoriesChange && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsAdding(true)}
                className="h-5 px-1 text-xs"
              >
                <Plus className="h-3 w-3" />
              </Button>
            )}
          </div>

          <div className="space-y-1 max-h-48 overflow-y-auto">
            {localDirectories.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">No additional directories</p>
            ) : (
              localDirectories.map((dir, index) => (
                <div key={index} className="flex items-center justify-between group hover:bg-muted/50 rounded px-1 py-0.5">
                  <span className="font-mono text-xs text-muted-foreground">
                    {dir}
                  </span>
                  {onDirectoriesChange && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveDirectory(dir)}
                      disabled={isUpdating}
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))
            )}

            {isAdding && (
              <div className="flex gap-1 pt-1">
                <Input
                  value={newDirectory}
                  onChange={(e) => setNewDirectory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddDirectory()
                    if (e.key === 'Escape') {
                      setIsAdding(false)
                      setNewDirectory('')
                    }
                  }}
                  placeholder="Enter directory path..."
                  className="h-7 text-xs"
                  autoFocus
                />
                <Button
                  size="sm"
                  onClick={handleAddDirectory}
                  disabled={isUpdating || !newDirectory.trim()}
                  className="h-7 px-2"
                >
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setIsAdding(false)
                    setNewDirectory('')
                  }}
                  className="h-7 px-2"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
