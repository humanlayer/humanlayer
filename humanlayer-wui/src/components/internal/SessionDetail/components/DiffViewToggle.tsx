import { Button } from '@/components/ui/button'
import { SquareSplitHorizontal, SquareSplitVertical } from 'lucide-react'

// TODO(3): Add user preference persistence for diff view mode
// TODO(3): Consider adding keyboard shortcut for toggling view

export function DiffViewToggle({
  isSplitView,
  onToggle,
}: {
  isSplitView: boolean
  onToggle: () => void
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onToggle}
      className="h-8 w-8 p-0 cursor-pointer"
      title={isSplitView ? 'Switch to inline view' : 'Switch to split view'}
    >
      {isSplitView ? (
        <SquareSplitVertical className="h-4 w-4" />
      ) : (
        <SquareSplitHorizontal className="h-4 w-4" />
      )}
    </Button>
  )
}
