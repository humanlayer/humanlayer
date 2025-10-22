import { useState, useRef, useEffect } from 'react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { QuickLauncherDirectoryInput } from './QuickLauncherDirectoryInput'
import { daemonClient } from '@/lib/daemon'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useHotkeys } from 'react-hotkeys-hook'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { emit } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { homeDir } from '@tauri-apps/api/path'
import { syncWindowBackgroundWithTheme } from '@/lib/windowTheme'
import { cn } from '@/lib/utils'
import { ShieldOff } from 'lucide-react'
import { usePostHogTracking } from '@/hooks/usePostHogTracking'
import { POSTHOG_EVENTS } from '@/lib/telemetry/events'

const LAST_WORKING_DIR_KEY = 'last-working-dir'

export function QuickLauncher() {
  const [workingDir, setWorkingDir] = useState('')
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoAccept, setAutoAccept] = useState(false)
  const [bypassPermissions, setBypassPermissions] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const { trackEvent } = usePostHogTracking()

  // Get recent directories from hook for fuzzy search
  const { paths: recentDirectories } = useRecentPaths()

  // Sync window background color with theme on mount and prevent scrolling
  useEffect(() => {
    syncWindowBackgroundWithTheme('quick-launcher')

    // Prevent scrolling on the body and html elements
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    // Focus the prompt field on mount
    promptRef.current?.focus()

    // Cleanup function to restore scroll when component unmounts
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [])

  // ESC to close window
  useHotkeys(
    'escape',
    async e => {
      e?.preventDefault()
      e?.stopPropagation()
      const window = getCurrentWindow()
      await window.close()
    },
    { enableOnFormTags: true },
  )

  // Cmd+Enter to submit - works globally
  useHotkeys(
    'meta+enter, ctrl+enter',
    e => {
      e.preventDefault()
      e.stopPropagation()
      handleSubmit()
    },
    {
      enableOnFormTags: true,
      preventDefault: true,
    },
  )

  const handleSubmit = async () => {
    if (!prompt.trim() || !workingDir.trim() || isLoading) return

    setIsLoading(true)
    setError(null)

    try {
      // Already validated that workingDir has a value
      const dirToUse = workingDir.trim()

      // Save working directory only if it was explicitly set
      if (workingDir.trim()) {
        localStorage.setItem(LAST_WORKING_DIR_KEY, dirToUse)
      }

      // Expand ~ to home directory if needed
      let expandedWorkingDir = dirToUse
      if (dirToUse.startsWith('~')) {
        const home = await homeDir()
        expandedWorkingDir = dirToUse.replace(/^~(?=$|\/|\\)/, home)
      }

      // Launch session with options
      const response = await daemonClient.launchSession({
        query: prompt,
        working_dir: expandedWorkingDir,
        provider: 'anthropic',
        autoAcceptEdits: autoAccept,
        dangerouslySkipPermissions: bypassPermissions,
      })

      // Track session creation event (not from draft)
      trackEvent(POSTHOG_EVENTS.SESSION_CREATED, {
        model: undefined, // Using default model
        provider: 'anthropic',
        from_draft: false,
      })

      // Try to notify the main window about the new session
      // This is best-effort - it's okay if the main window isn't open
      try {
        const mainWindow = await WebviewWindow.getByLabel('main')
        if (mainWindow) {
          await emit('session-created', { sessionId: response.sessionId })
        }
      } catch {
        // Ignore errors from main window notification - it's optional
      }

      // Close the quick launcher window
      const window = getCurrentWindow()
      await window.close()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col p-2 bg-background" style={{ height: '180px' }}>
      {/* Prompt field at the top */}
      <div className="flex-1 space-y-1">
        <Label htmlFor="prompt" className="text-xs">
          Prompt
        </Label>
        <Textarea
          id="prompt"
          ref={promptRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="What would you like help with?"
          className="h-[60px] resize-none text-xs font-mono"
        />
      </div>

      {error && <div className="text-xs text-destructive mt-1">{error}</div>}

      {/* Directory and submit button inline */}
      <div className="flex items-end gap-2 mt-2">
        <div className="flex-1 relative">
          <Label htmlFor="working-dir" className="text-xs">
            Directory
          </Label>
          <QuickLauncherDirectoryInput
            value={workingDir}
            onChange={setWorkingDir}
            recentDirectories={recentDirectories}
            className="font-mono text-xs h-7"
            placeholder="/path/to/directory"
            onSubmit={() => {
              handleSubmit()
            }}
          />
        </div>

        <Button
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={handleSubmit}
          disabled={!prompt.trim() || !workingDir.trim() || isLoading}
        >
          {isLoading ? '...' : 'Submit'}
        </Button>
      </div>

      {/* Mode badges below */}
      <div className="flex gap-1">
        <button
          className={cn(
            'p-1 rounded transition-colors',
            autoAccept
              ? ['text-[var(--terminal-warning)]']
              : ['text-muted-foreground/40', 'hover:text-muted-foreground/60'],
          )}
          onClick={() => setAutoAccept(!autoAccept)}
          tabIndex={0}
          type="button"
          title="Auto-accept edits"
        >
          <span className="text-sm leading-none">⏵⏵</span>
        </button>

        <button
          className={cn(
            'p-1 rounded transition-colors',
            bypassPermissions
              ? ['text-[var(--terminal-error)]']
              : ['text-muted-foreground/40', 'hover:text-muted-foreground/60'],
          )}
          onClick={() => setBypassPermissions(!bypassPermissions)}
          tabIndex={0}
          type="button"
          title="Bypass permissions"
        >
          <ShieldOff className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
