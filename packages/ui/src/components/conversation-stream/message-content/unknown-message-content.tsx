import { AlertCircle } from 'lucide-react'
import type { FC } from 'react'

export const UnknownMessageContent: FC = () => {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <AlertCircle className="w-4 h-4" />
      <span>Unknown message type</span>
    </div>
  )
}
