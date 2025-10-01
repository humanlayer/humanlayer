import { Button } from '@/components/ui/button'
import { daemonClient } from '@/lib/daemon/client'
import { getLastWorkingDir } from '@/hooks'

export function SessionsEmptyState() {
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
      <div className="flex flex-col items-start w-full max-w-xl">
        <h1 className="text-2xl font-semibold mb-8">Welcome</h1>

        <div className="text-sm text-muted-foreground mb-8 space-y-4">
          <p>
            CodeLayer is a tool for using AI Coding Agents to solve hard problems in complex codebases.
          </p>

          <p>
            It uses your default claude code settings and api keys and supports any agents / slash
            commands you have configured.
          </p>

          <p>Create a session to get started.</p>
        </div>

        <Button onClick={handleCreateSession} size="lg">
          Create Session{' '}
          <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            C
          </kbd>
        </Button>
      </div>
    </div>
  )
}
