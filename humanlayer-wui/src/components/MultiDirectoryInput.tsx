import { useState } from 'react'
import { SearchInput } from './FuzzySearchInput'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { X } from 'lucide-react'
import type { RecentPath } from '@/lib/daemon'
import { Label } from './ui/label'

interface MultiDirectoryInputProps {
  directories: string[]
  onDirectoriesChange: (directories: string[]) => void
  recentDirectories?: RecentPath[]
  placeholder?: string
}

export function MultiDirectoryInput({
  directories = [],
  onDirectoriesChange,
  recentDirectories = [],
  placeholder = 'Add a directory...',
}: MultiDirectoryInputProps) {
  const [currentInput, setCurrentInput] = useState('')

  const handleAddDirectory = (directoryPath?: string) => {
    const pathToAdd = directoryPath || currentInput;
    const trimmedInput = pathToAdd.trim()
    if (trimmedInput && !directories.includes(trimmedInput)) {
      const newDirs = [...directories, trimmedInput]
      console.log('Adding directory:', trimmedInput)
      console.log('New directories list:', newDirs)
      onDirectoriesChange(newDirs)
      setCurrentInput('')
    }
  }

  const handleRemoveDirectory = (dirToRemove: string) => {
    const newDirs = directories.filter(dir => dir !== dirToRemove)
    console.log('Removing directory:', dirToRemove)
    console.log('New directories list:', newDirs)
    onDirectoriesChange(newDirs)
  }

  return (
    <div className="space-y-2">
      <Label>Additional Directories (optional)</Label>

      {/* Display selected directories as badges */}
      {directories.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {directories.map(dir => (
            <Badge key={dir} variant="secondary" className="flex items-center gap-1 px-2 py-1">
              <span className="text-xs truncate max-w-[200px]" title={dir}>
                {dir}
              </span>
              <button
                onClick={() => handleRemoveDirectory(dir)}
                className="ml-1 hover:bg-secondary-foreground/20 rounded p-0.5"
                aria-label={`Remove ${dir}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* Input for adding new directories */}
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <SearchInput
            value={currentInput}
            onChange={setCurrentInput}
            onSubmit={(value) => {
              // Use the value from SearchInput (selected item or typed text)
              handleAddDirectory(value);
            }}
            placeholder={placeholder}
            recentDirectories={recentDirectories}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="default"
          onClick={() => handleAddDirectory(currentInput)}
          disabled={!currentInput.trim()}
          className="mt-2"
        >
          Add
        </Button>
      </div>
    </div>
  )
}
