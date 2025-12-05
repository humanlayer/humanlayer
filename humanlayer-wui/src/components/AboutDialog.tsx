import { useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Info, Terminal, Zap } from 'lucide-react'
import { useHotkeys } from 'react-hotkeys-hook'
import { HotkeyScopeBoundary } from './HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { getAppVersion, formatVersionForDisplay } from '@/lib/version'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  // Handle Escape and Enter to close
  useHotkeys(
    'escape, enter',
    e => {
      e.preventDefault()
      e.stopPropagation()
      onOpenChange(false)
    },
    {
      enabled: open,
      enableOnFormTags: true,
      preventDefault: true,
      scopes: [HOTKEY_SCOPES.ABOUT_DIALOG],
    },
  )

  const version = getAppVersion()
  const displayVersion = formatVersionForDisplay(version)

  return (
    <HotkeyScopeBoundary
      scope={HOTKEY_SCOPES.ABOUT_DIALOG}
      isActive={open}
      rootScopeDisabled={true}
      componentName="AboutDialog"
    >
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-lg"
          onOpenAutoFocus={e => {
            e.preventDefault()
            closeButtonRef.current?.focus()
          }}
        >
          <DialogHeader>
            <div className="flex items-center gap-3">
              <Terminal className="h-6 w-6 text-[var(--terminal-accent)]" />
              <DialogTitle>Welcome to CodeLayer</DialogTitle>
            </div>
            <DialogDescription className="text-left">
              A powerful tool for working with AI agents in your development workflow.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <h4 className="flex items-center gap-2 text-sm font-medium text-[var(--terminal-accent)] mb-2">
                <Zap className="h-4 w-4" />
                What CodeLayer does:
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1 ml-6">
                <li>• Research codebases and gather context</li>
                <li>• Plan implementations with detailed specifications</li>
                <li>• Refine plans through iterative collaboration</li>
                <li>• Implement features with human oversight</li>
                <li>• And much more...</li>
              </ul>
            </div>

            <div>
              <h4 className="flex items-center gap-2 text-sm font-medium text-[var(--terminal-accent)] mb-2">
                <Info className="h-4 w-4" />
                Getting started:
              </h4>
              <div className="text-sm text-muted-foreground ml-6 space-y-2">
                <p>
                  <strong>1.</strong> Create a session in your working directory
                </p>
                <p>
                  <strong>2.</strong> Type{' '}
                  <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded border border-border font-mono">
                    /
                  </kbd>{' '}
                  to see available HumanLayer-defined commands
                </p>
                <p>
                  <strong>3.</strong> Select a command to start working with Claude
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              ref={closeButtonRef}
              variant="default"
              onClick={() => onOpenChange(false)}
              className="w-full sm:w-auto"
            >
              Got it
              <kbd className="ml-2 px-1 py-0.5 text-xs bg-muted/50 rounded">ENTER</kbd>
            </Button>
          </DialogFooter>

          <div className="bg-muted/50 p-3 rounded-lg">
            <p className="text-xs text-muted-foreground text-center font-mono">
              CodeLayer {displayVersion}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </HotkeyScopeBoundary>
  )
}
