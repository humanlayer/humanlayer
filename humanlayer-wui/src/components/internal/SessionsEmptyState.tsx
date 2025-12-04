import { Button } from '@/components/ui/button'
import { daemonClient } from '@/lib/daemon/client'
import { getLastWorkingDir } from '@/hooks'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { useHotkeyUnicodeChars } from '@/hooks/useHotkeyUnicodeChars'
import { KeyboardShortcut } from '../HotkeyPanel'
import { Terminal, Zap, Info } from 'lucide-react'

export function SessionsEmptyState() {
  const { open } = useSessionLauncher()
  const { Mod } = useHotkeyUnicodeChars()

  const handleCreateSession = async () => {
    try {
      const response = await daemonClient.launchSession({
        query: '',
        working_dir: getLastWorkingDir() || '~/',
        draft: true,
      })
      window.location.hash = `#/sessions/${response.sessionId}`
    } catch (error) {
      console.error('Failed to create draft session:', error)
    }
  }

  return (
    <div className="flex justify-center py-20 px-8">
      <div className="flex flex-col items-start w-full max-w-2xl">
        <div className="flex items-center gap-3 mb-2">
          <Terminal className="h-8 w-8 text-[var(--terminal-accent)]" />
          <h1 className="text-2xl font-semibold">Welcome to CodeLayer</h1>
        </div>

        <p className="text-sm text-muted-foreground mb-8">
          A powerful tool for working with AI agents in your development workflow.
        </p>

        <div className="space-y-6 mb-8 w-full">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--terminal-accent)] mb-3">
              <Zap className="h-4 w-4" />
              What CodeLayer does:
            </h3>
            <ul className="text-sm text-muted-foreground space-y-2 ml-6">
              <li>• Research codebases and gather context</li>
              <li>• Plan implementations with detailed specifications</li>
              <li>• Refine plans through iterative collaboration</li>
              <li>• Implement features with human oversight</li>
              <li>• And much more...</li>
            </ul>
          </div>

          <div>
            <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--terminal-accent)] mb-3">
              <Info className="h-4 w-4" />
              Getting started:
            </h3>
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

          <div className="bg-muted/50 p-4 rounded-lg">
            <p className="text-sm text-muted-foreground">
              CodeLayer uses your default Claude Code settings and API keys, and supports any agents or
              slash commands you have configured.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleCreateSession} size="lg">
            Create Session <KeyboardShortcut keyString="C" />
          </Button>
          <Button variant="secondary" size="lg" onClick={() => open()}>
            Open command palette <KeyboardShortcut keyString={`${Mod}+K`} />
          </Button>
        </div>
      </div>
    </div>
  )
}
