import { useStore } from '@/AppStore'
import { usePostHogTracking } from '@/hooks/usePostHogTracking'
import { POSTHOG_EVENTS } from '@/lib/telemetry/events'
import { SearchInput } from '@/components/FuzzySearchInput'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { LAST_WORKING_DIR_KEY } from '@/hooks/useSessionLauncher'
import { daemonClient } from '@/lib/daemon'
import { type Session, ViewMode } from '@/lib/daemon/types'
import { FolderOpen, TextSearch } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { DangerouslySkipPermissionsDialog } from '../DangerouslySkipPermissionsDialog'
import { DiscardDraftDialog } from './DiscardDraftDialog'
import { DraftLauncherInput } from './DraftLauncherInput'

interface DraftLauncherProps {
  session: Session
  onSessionUpdated?: () => void
}

export const DraftLauncher: React.FC<DraftLauncherProps> = ({ session, onSessionUpdated }) => {
  const navigate = useNavigate()
  const titleInputRef = useRef<HTMLInputElement>(null)
  const { trackEvent } = usePostHogTracking()

  // Draft-specific state
  const [isLaunchingDraft, setIsLaunchingDraft] = useState(false)
  const [showDiscardDraftDialog, setShowDiscardDraftDialog] = useState(false)
  const [selectedDirectory, setSelectedDirectory] = useState<string>(() => {
    return session.workingDir || ''
  })
  const [dangerousSkipPermissionsDialogOpen, setDangerousSkipPermissionsDialogOpen] = useState(false)

  // Local storage for draft settings
  const [autoAcceptEnabled, setAutoAcceptEnabled] = useLocalStorage('draft-auto-accept', false)
  const [bypassEnabled, setBypassEnabled] = useLocalStorage('draft-bypass-permissions', false)

  // Track initial values to detect changes
  const [initialAutoAccept] = useState(autoAcceptEnabled)
  const [initialBypass] = useState(bypassEnabled)

  // Local storage for model/provider persistence
  const [lastUsedModel, setLastUsedModel] = useLocalStorage('draft-last-model', '')
  const [lastUsedProvider, setLastUsedProvider] = useLocalStorage('draft-last-provider', 'anthropic')
  const [lastUsedProxyModel, setLastUsedProxyModel] = useLocalStorage('draft-last-proxy-model', '')
  const [, setLastUsedProxyBaseUrl] = useLocalStorage('draft-last-proxy-base-url', '')

  // Hooks
  const { paths: recentPaths } = useRecentPaths()
  const responseEditor = useStore(state => state.responseEditor)

  // Update selectedDirectory when session.workingDir changes
  useEffect(() => {
    if (session.workingDir) {
      setSelectedDirectory(session.workingDir)
    }
  }, [session.workingDir])

  // Handle launching a draft session
  const handleLaunchDraft = useCallback(
    async (settings: { autoAcceptEdits: boolean; dangerouslySkipPermissions: boolean }) => {
      if (isLaunchingDraft) return

      // Use either the selected directory or the session's existing workingDir
      const workingDir = selectedDirectory || session.workingDir

      // Validate that a directory is selected or exists on the session
      if (!workingDir) {
        toast.error('Please select a working directory', {
          description: 'You must choose a directory before launching the session',
        })
        return
      }

      try {
        setIsLaunchingDraft(true)

        // Get the editor content and process mentions/slash commands properly
        let prompt = ''
        if (responseEditor) {
          const json = responseEditor.getJSON()

          const processNode = (node: any): string => {
            if (node.type === 'text') {
              return node.text || ''
            } else if (node.type === 'mention' || node.type === 'slash-command') {
              // Use the full path (id) instead of the display label
              return node.attrs.id || node.attrs.label || ''
            } else if (node.type === 'paragraph' && node.content) {
              return node.content.map(processNode).join('')
            } else if (node.type === 'doc' && node.content) {
              return node.content.map(processNode).join('\n')
            } else if (node.type === 'hardBreak') {
              return '\n'
            }
            return ''
          }

          prompt = processNode(json)
        }

        // Apply the settings from DraftLauncherInput to the draft session before launching
        await daemonClient.updateSession(session.id, {
          autoAcceptEdits: settings.autoAcceptEdits,
          dangerouslySkipPermissions: settings.dangerouslySkipPermissions,
        })

        // Launch the draft session with the prompt
        // Note: working directory is already updated when selected in the fuzzy finder
        await daemonClient.launchDraftSession(session.id, prompt)

        // Track session creation event
        trackEvent(POSTHOG_EVENTS.SESSION_CREATED, {
          model: session.model || session.proxyModelOverride || undefined,
          provider: session.proxyEnabled
            ? (session.proxyBaseUrl?.includes('baseten') ? 'baseten' : 'openrouter')
            : 'anthropic',
        })

        // store working directory in localStorage
        localStorage.setItem(LAST_WORKING_DIR_KEY, selectedDirectory || '')

        // Clear the input after successful launch
        responseEditor?.commands.setContent('')
        localStorage.removeItem(`response-input.${session.id}`)

        const storeState = useStore.getState()

        // Refresh sessions to update the session list, set view mode to 'normal'
        await storeState.refreshSessions()
        await storeState.setViewMode(ViewMode.Normal)

        // Session status will update via WebSocket
      } catch (error) {
        toast.error('Failed to launch draft session', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        setIsLaunchingDraft(false)
      }
    },
    [session.id, session.workingDir, session.model, session.proxyModelOverride, session.proxyEnabled, session.proxyBaseUrl, responseEditor, isLaunchingDraft, selectedDirectory, trackEvent],
  )

  // Handle title changes
  const handleTitleChange = useCallback(
    async (newTitle: string) => {
      useStore.getState().updateSession(session.id, { title: newTitle })

      try {
        await daemonClient.updateSessionTitle(session.id, newTitle)
      } catch (error) {
        toast.error('Failed to update session title', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    [session.id],
  )

  // Handle directory selection
  const handleDirectoryChange = useCallback(
    async (newDirectory: string) => {
      // Update local state immediately
      setSelectedDirectory(newDirectory)

      // If it's a valid directory and different from current, update backend
      if (newDirectory && newDirectory !== session.workingDir) {
        try {
          await daemonClient.updateSession(session.id, {
            workingDir: newDirectory,
          })
          // Update the store to reflect the change
          useStore.getState().updateSession(session.id, { workingDir: newDirectory })
        } catch (error) {
          toast.error('Failed to update working directory', {
            description: error instanceof Error ? error.message : 'Unknown error',
          })
          // Revert local state on error
          setSelectedDirectory(session.workingDir || '')
        }
      }
    },
    [session.id, session.workingDir],
  )

  // Handle discard draft
  const handleDiscardDraft = useCallback(() => {
    // Check if there are any changes to the draft
    let hasChanges = false

    // Check if title has been set (non-empty and different from summary)
    if (session.title && session.title.trim() !== '') {
      hasChanges = true
    }

    // Check if prompt draft is non-empty
    if (responseEditor && !responseEditor.isEmpty) {
      hasChanges = true
    }

    // Check if working directory has been changed from initial state
    // Initial state would be empty string if no workingDir was set on session load
    const initialWorkingDir = session.workingDir || ''
    if (selectedDirectory !== initialWorkingDir) {
      hasChanges = true
    }

    // Check if auto-accept or bypass settings have been changed from initial values
    if (autoAcceptEnabled !== initialAutoAccept || bypassEnabled !== initialBypass) {
      hasChanges = true
    }

    if (hasChanges) {
      setShowDiscardDraftDialog(true)
    } else {
      // No changes, just navigate back using browser history
      navigate(-1)
    }
  }, [
    navigate,
    session.title,
    session.workingDir,
    selectedDirectory,
    responseEditor,
    autoAcceptEnabled,
    bypassEnabled,
    initialAutoAccept,
    initialBypass,
  ])

  const confirmDiscardDraft = useCallback(async () => {
    try {
      // Delete the draft session
      await daemonClient.deleteDraftSession(session.id)

      // Clear localStorage
      localStorage.removeItem(`response-input.${session.id}`)

      // Refresh sessions to update counts
      await useStore.getState().refreshSessions()

      // Navigate back using browser history
      navigate(-1)
    } catch (error) {
      toast.error('Failed to discard draft', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [session.id, navigate])

  // Handle toggling auto-accept
  const handleToggleAutoAccept = useCallback(() => {
    setAutoAcceptEnabled(!autoAcceptEnabled)
  }, [autoAcceptEnabled, setAutoAcceptEnabled])

  // Handle toggling bypass permissions
  const handleToggleBypass = useCallback(() => {
    if (bypassEnabled) {
      // If currently enabled, disable it directly
      setBypassEnabled(false)
    } else {
      // If currently disabled, show the modal to confirm enabling
      setDangerousSkipPermissionsDialogOpen(true)
    }
  }, [bypassEnabled, setBypassEnabled])

  // Handle bypass dialog confirmation
  const handleDangerousSkipPermissionsConfirm = useCallback(async () => {
    // For drafts, we just enable the setting, we don't use timeout
    setBypassEnabled(true)
    setDangerousSkipPermissionsDialogOpen(false)
  }, [setBypassEnabled])

  // Handle model change - save to localStorage for next draft
  const handleModelChange = useCallback(() => {
    // Detect and save the current model/provider configuration
    if (session.proxyEnabled && session.proxyModelOverride) {
      // Using proxy (OpenRouter or Baseten)
      if (session.proxyBaseUrl?.includes('baseten.co')) {
        setLastUsedProvider('baseten')
        setLastUsedProxyBaseUrl('https://inference.baseten.co/v1')
      } else {
        setLastUsedProvider('openrouter')
        setLastUsedProxyBaseUrl('https://openrouter.ai/api/v1')
      }
      setLastUsedProxyModel(session.proxyModelOverride)
      setLastUsedModel('')
    } else if (session.model) {
      // Using Anthropic
      setLastUsedProvider('anthropic')
      setLastUsedModel(session.model)
      setLastUsedProxyModel('')
      setLastUsedProxyBaseUrl('')
    }

    // Call the parent handler if provided
    if (onSessionUpdated) {
      onSessionUpdated()
    }
  }, [
    session.model,
    session.proxyEnabled,
    session.proxyModelOverride,
    session.proxyBaseUrl,
    setLastUsedModel,
    setLastUsedProvider,
    setLastUsedProxyModel,
    setLastUsedProxyBaseUrl,
    onSessionUpdated,
  ])

  // Hotkeys - scoped to DRAFT_LAUNCHER
  useHotkeys(
    'escape',
    () => {
      // Check if the response editor is focused
      if (responseEditor?.isFocused) {
        // Blur the editor if it's focused
        responseEditor.commands.blur()
        return
      }

      // Check if any form element is focused
      const activeElement = document.activeElement
      const isFormElementFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'SELECT'

      if (isFormElementFocused && activeElement instanceof HTMLElement) {
        // Blur the focused form element
        activeElement.blur()
        return
      }

      // If nothing is focused, navigate back using browser history
      navigate(-1)
    },
    {
      scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
      enableOnFormTags: true, // Enable escape key in form elements
    },
    [responseEditor, navigate],
  )

  // Enter key to refocus the prompt input when no field is focused
  useHotkeys(
    'enter',
    e => {
      // Only refocus if no input is currently focused
      const activeElement = document.activeElement
      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.getAttribute('contenteditable') === 'true'

      if (!isInputFocused && responseEditor && !responseEditor.isFocused) {
        e.preventDefault()
        responseEditor.commands.focus()
      }
    },
    {
      scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
      enableOnFormTags: false, // Don't trigger when in form elements
      enableOnContentEditable: false, // Don't trigger when in contenteditable
    },
    [responseEditor],
  )

  // 'e' key to discard draft (only when not in form fields)
  useHotkeys(
    'e',
    e => {
      console.log('delete attempt')
      e.preventDefault()
      handleDiscardDraft()
    },
    {
      scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [handleDiscardDraft],
  )

  useHotkeys(
    'shift+r',
    e => {
      e.preventDefault()
      if (titleInputRef.current) {
        titleInputRef.current.focus()
      }
    },
    {
      scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
  )

  // Alt+A / Option+A to toggle auto-accept
  useHotkeys(
    'alt+a, option+a',
    e => {
      e.preventDefault()
      handleToggleAutoAccept()
    },
    {
      enableOnFormTags: ['INPUT', 'TEXTAREA', 'SELECT'],
      enableOnContentEditable: true,
      scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
    },
    [handleToggleAutoAccept],
  )

  // Alt+Y / Option+Y to toggle bypass permissions
  useHotkeys(
    'alt+y, option+y',
    e => {
      e.preventDefault()
      handleToggleBypass()
    },
    {
      enableOnFormTags: ['INPUT', 'TEXTAREA', 'SELECT'],
      enableOnContentEditable: true,
      scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
    },
    [handleToggleBypass],
  )

  // Auto-focus title on mount and apply saved model settings
  useEffect(() => {
    if (titleInputRef.current) {
      titleInputRef.current.focus()
    }

    // Apply saved model/provider settings if this is a new draft without model settings
    if (
      session.status === 'draft' &&
      !session.model &&
      !session.proxyEnabled &&
      !session.proxyModelOverride
    ) {
      const applyModelSettings = async () => {
        try {
          let updateData: any = {}

          if (lastUsedProvider === 'anthropic' && lastUsedModel) {
            updateData = {
              model: lastUsedModel,
              proxyEnabled: false,
              proxyBaseUrl: undefined,
              proxyModelOverride: undefined,
            }
          } else if (lastUsedProvider === 'openrouter' && lastUsedProxyModel) {
            updateData = {
              model: '',
              proxyEnabled: true,
              proxyBaseUrl: 'https://openrouter.ai/api/v1',
              proxyModelOverride: lastUsedProxyModel,
            }
          } else if (lastUsedProvider === 'baseten' && lastUsedProxyModel) {
            updateData = {
              model: '',
              proxyEnabled: true,
              proxyBaseUrl: 'https://inference.baseten.co/v1',
              proxyModelOverride: lastUsedProxyModel,
            }
          }

          if (Object.keys(updateData).length > 0) {
            await daemonClient.updateSession(session.id, updateData)
            // Update the store to reflect the changes
            useStore.getState().updateSession(session.id, updateData)
          }
        } catch (error) {
          // Silently fail - this is just a convenience feature
          console.warn('Failed to apply saved model settings:', error)
        }
      }

      applyModelSettings()
    }
  }, [
    session.id,
    session.status,
    session.model,
    session.proxyEnabled,
    session.proxyModelOverride,
    lastUsedProvider,
    lastUsedModel,
    lastUsedProxyModel,
  ])

  return (
    <HotkeyScopeBoundary scope={HOTKEY_SCOPES.DRAFT_LAUNCHER} componentName="DraftLauncher">
      <div className="flex flex-col h-full">
        {/* Title and Directory Selection */}
        <div className="px-2">
          <div className="mb-2">
            <Label className="text-xs mb-1 uppercase tracking-wider text-muted-foreground">
              <TextSearch className="h-3 w-3" /> title
            </Label>
            <Input
              ref={titleInputRef}
              placeholder="Describe this session..."
              className="mt-1"
              value={session.title || session.summary || ''}
              onChange={e => handleTitleChange(e.target.value)}
            />
          </div>

          <div className="mb-2">
            <Label className="text-xs mb-1 uppercase tracking-wider text-muted-foreground">
              <FolderOpen className="h-3 w-3" /> working directory
            </Label>
            <SearchInput
              placeholder="Select a directory to work in..."
              className="mt-1"
              recentDirectories={recentPaths}
              value={selectedDirectory}
              onChange={handleDirectoryChange}
              onSubmit={value => value && handleDirectoryChange(value)}
            />
          </div>

          {/* Draft Launcher Input - inside the px-2 container */}
          <DraftLauncherInput
            session={session}
            onLaunchDraft={handleLaunchDraft}
            onDiscardDraft={handleDiscardDraft}
            isLaunchingDraft={isLaunchingDraft}
            onModelChange={handleModelChange}
            autoAcceptEnabled={autoAcceptEnabled}
            bypassEnabled={bypassEnabled}
            onToggleAutoAccept={handleToggleAutoAccept}
            onToggleBypass={handleToggleBypass}
          />
        </div>

        {/* Empty space to push content to top */}
        <div className="flex-1" />

        {/* Discard Draft Dialog */}
        <DiscardDraftDialog
          open={showDiscardDraftDialog}
          onConfirm={confirmDiscardDraft}
          onCancel={() => setShowDiscardDraftDialog(false)}
        />

        {/* Dangerously Skip Permissions Dialog */}
        <DangerouslySkipPermissionsDialog
          open={dangerousSkipPermissionsDialogOpen}
          onOpenChange={setDangerousSkipPermissionsDialogOpen}
          onConfirm={handleDangerousSkipPermissionsConfirm}
        />
      </div>
    </HotkeyScopeBoundary>
  )
}
