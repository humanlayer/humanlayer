import { useRef } from 'react'
import { Button } from '@humanlayer/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { FolderOpen } from 'lucide-react'

export interface AttachFileButtonProps {
  onFiles: (files: File[]) => void
  disabled?: boolean
}

export function AttachFileButton({ onFiles, disabled }: AttachFileButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) {
      onFiles(files)
    }
    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  return (
    <>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={handleChange} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={handleClick} disabled={disabled}>
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>Attach files</p>
        </TooltipContent>
      </Tooltip>
    </>
  )
}
