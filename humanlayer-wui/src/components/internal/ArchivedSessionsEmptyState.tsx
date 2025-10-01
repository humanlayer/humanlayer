import { Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ArchivedSessionsEmptyStateProps {
  onNavigateBack: () => void
}

export function ArchivedSessionsEmptyState({ onNavigateBack }: ArchivedSessionsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <Archive className="h-12 w-12 text-muted-foreground mb-4" />

      <h3 className="text-lg font-semibold mb-2">No archived sessions</h3>

      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        Sessions you archive will appear here. Press ESC or click below to go back.
      </p>

      <Button onClick={onNavigateBack} variant="ghost">
        View all sessions
      </Button>
    </div>
  )
}
