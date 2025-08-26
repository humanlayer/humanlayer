import { Button } from '@/components/ui/button'

export function DenyForm({ isDenying, onCancel }: { isDenying: boolean; onCancel?: () => void }) {
  return (
    <>
      <Button
        className="cursor-pointer"
        type="submit"
        size="sm"
        variant="destructive"
        disabled={isDenying}
      >
        {isDenying ? 'Denying...' : 'Deny'}{' '}
        {!isDenying && <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">⏎</kbd>}
      </Button>
      <Button
        className="cursor-pointer"
        type="button"
        size="sm"
        variant="outline"
        onClick={onCancel}
        disabled={isDenying}
      >
        Cancel <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Esc</kbd>
      </Button>
    </>
  )
}
