import { Button } from '@/components/ui/button'

export function DenyButtons({
  isDenying,
  onCancel,
  onDeny,
  isDisabled,
}: {
  isDenying: boolean
  onCancel?: () => void
  onDeny?: () => void
  isDisabled?: boolean
}) {
  const isMac = navigator.platform.includes('Mac')
  const sendKey = isMac ? '⌘+ENTER' : 'Ctrl+ENTER'

  return (
    <div
      onClick={e => {
        // Stop propagation for any clicks on the button container
        e.stopPropagation()
      }}
      className="inline-flex gap-2"
    >
      <Button
        className={isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        type="button"
        size="sm"
        variant="destructive"
        onClick={e => {
          e.stopPropagation()
          if (!isDisabled) {
            onDeny?.()
          }
        }}
        disabled={isDisabled}
      >
        Deny
        {isDenying && <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">{sendKey}</kbd>}
      </Button>
      <Button
        className="cursor-pointer"
        type="button"
        size="sm"
        variant="outline"
        onClick={e => {
          e.stopPropagation()
          onCancel?.()
        }}
      >
        Cancel <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Esc</kbd>
      </Button>
    </div>
  )
}
