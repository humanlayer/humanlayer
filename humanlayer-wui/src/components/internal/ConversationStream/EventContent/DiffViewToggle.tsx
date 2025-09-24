import { Button } from '@/components/ui/button'
import { SquareSplitHorizontal, SquareSplitVertical } from 'lucide-react'

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
