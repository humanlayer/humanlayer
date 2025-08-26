import { Button } from '@/components/ui/button'

export function DenyButtons({ isDenying, onCancel }: { isDenying: boolean; onCancel?: () => void }) {
  const isMac = navigator.platform.includes('Mac')
  const sendKey = isMac ? '⌘+⏎' : 'Ctrl+⏎'

  return (
    <>
      <Button className="cursor-pointer" type="submit" size="sm" variant="destructive">
        Deny
        {isDenying && <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">{sendKey}</kbd>}
      </Button>
      <Button className="cursor-pointer" type="button" size="sm" variant="outline" onClick={onCancel}>
        Cancel <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Esc</kbd>
      </Button>
    </>
  )
}
