import React from 'react'
import { FileText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ResearchPlanTokenProps {
  path: string
  workingDir?: string
}

export function ResearchPlanToken({ path, workingDir }: ResearchPlanTokenProps) {
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)

  // Determine if this is a research path or a plan path
  const isResearchPath = path.includes('thoughts/shared/research/')
  const isPlanPath = path.includes('thoughts/shared/plans/')

  // Use /create_plan for research paths, /implement_plan for plan paths
  const commandPrefix = isResearchPath
    ? '/create_plan'
    : isPlanPath
      ? '/implement_plan'
      : '/create_plan'
  const menuLabel = isResearchPath ? 'Create Plan' : isPlanPath ? 'Implement Plan' : 'Create Plan'

  const handleAction = React.useCallback(() => {
    const fileName = path.split('/').pop() || path
    const titlePrefix = isResearchPath ? 'research/' : isPlanPath ? 'plans/' : ''
    navigate('/sessions/draft', {
      state: {
        prompt: `${commandPrefix} ${path}`,
        title: `${titlePrefix}${fileName}`,
        workingDir: workingDir || undefined,
      },
    })
    setOpen(false)
  }, [navigate, path, workingDir, commandPrefix, isResearchPath, isPlanPath])

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          className="inline-flex items-center gap-1 group cursor-pointer"
          onContextMenu={event => {
            event.preventDefault()
            setOpen(true)
          }}
        >
          <code className="px-2 py-0.5 rounded font-mono text-xs bg-[var(--terminal-bg-alt)] text-[var(--terminal-accent)] border border-[var(--terminal-border)] tracking-tight shadow-sm mr-1 align-middle wrap-anywhere box-decoration-clone">
            {path}
          </code>
          <button
            type="button"
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
            onClick={event => {
              event.preventDefault()
              setOpen(true)
            }}
            aria-label={isPlanPath ? 'Open plan menu' : 'Open research plan menu'}
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4}>
        <DropdownMenuItem
          onSelect={event => {
            event.preventDefault()
            handleAction()
          }}
        >
          <FileText className="h-4 w-4" />
          {menuLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
