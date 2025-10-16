import { useStore } from '@/AppStore'
import { SearchInput } from '@/components/FuzzySearchInput'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { daemonClient } from '@/lib/daemon'
import { type Session, ViewMode } from '@/lib/daemon/types'
import { FolderOpen, TextSearch } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { DangerouslySkipPermissionsDialog } from '../DangerouslySkipPermissionsDialog'
import { DiscardDraftDialog } from './DiscardDraftDialog'
import { DraftLauncherInput } from './DraftLauncherInput'

interface DraftLauncherFormProps {
  session: Session | null
  onSessionUpdated?: () => void
  //onCreateDraft?: () => Promise<Session | null | undefined>
}

export const DraftLauncherForm: React.FC<DraftLauncherFormProps> = ({ session, onSessionUpdated }) => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Core Form State
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [title, setTitle] = useState(session?.title ?? session?.summary ?? '')

  // Refs for mutable values to avoid re-render issues
  const titleRef = useRef(title)
  const workingDirectoryRef = useRef(session?.workingDir ?? '')
  const sessionIdRef = useRef<string | null>(null)
  const draftCreatingRef = useRef(false)

  // Local Storage State
  const [workingDirectory, setWorkingDirectory] = useLocalStorage(
    'draft-working-directory',
    session?.workingDir ?? '',
  )
  const [
    defaultAutoAcceptEditsSetting,
    setDefaultAutoAcceptEditsSetting,
    defaultAutoAcceptEditsSettingChecked,
  ] = useLocalStorage('draft-auto-accept', session?.autoAcceptEdits ?? false)
  const [
    defaultDangerouslyBypassPermissionsSetting,
    setDefaultDangerouslyBypassPermissionsSetting,
    defaultDangerouslyBypassPermissionsSettingChecked,
  ] = useLocalStorage('draft-bypass-permissions', session?.dangerouslySkipPermissions ?? false)

  // Model/Provider Persistence (via useLocalStorage)
  const [lastUsedModel, setLastUsedModel, lastUsedModelLoaded] = useLocalStorage('draft-last-model', '')
  const [lastUsedProvider, setLastUsedProvider, lastUsedProviderLoaded] = useLocalStorage(
    'draft-last-provider',
    'anthropic',
  )
  const [lastUsedProxyModel, setLastUsedProxyModel, lastUsedProxyModelLoaded] = useLocalStorage(
    'draft-last-proxy-model',
    '',
  )
  const [lastUsedProxyBaseUrl, setLastUsedProxyBaseUrl, lastUsedProxyBaseUrlLoaded] = useLocalStorage(
    'draft-last-proxy-base-url',
    '',
  )

  const [, setAcceptEditsEnabled] = useState(session?.autoAcceptEdits ?? false)
  const [, setDangerouslyBypassPermissionsEnabled] = useState(
    session?.dangerouslySkipPermissions ?? false,
  )

  // Model/Provider State
  const [model, setModel] = useState(session?.model ?? '')

  const [proxyEnabled, setProxyEnabled] = useState(session?.proxyEnabled ?? false)
  const [proxyBaseUrl, setProxyBaseUrl] = useState<string | null>(session?.proxyBaseUrl ?? null)
  const [proxyModelOverride, setProxyModelOverride] = useState<string | null>(
    session?.proxyModelOverride ?? null,
  )
  const [, setProvider] = useState<'anthropic' | 'baseten' | 'openrouter'>(
    session?.proxyBaseUrl
      ? session?.proxyBaseUrl?.includes('baseten.co')
        ? 'baseten'
        : 'openrouter'
      : 'anthropic',
  )

  // UI State
  const [isLaunchingDraft, setIsLaunchingDraft] = useState(false)
  const [showDiscardDraftDialog, setShowDiscardDraftDialog] = useState(false)
  const [dangerousSkipPermissionsDialogOpen, setDangerousSkipPermissionsDialogOpen] = useState(false)
  // Sync timer for debouncing updates
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Hooks
  const { paths: recentPaths } = useRecentPaths()
  const responseEditor = useStore(state => state.responseEditor)
  const refreshSessions = useStore(state => state.refreshSessions)

  const draftCreatedRef = useRef<boolean>(!!session) // if a session is passed in then the draft has already been created

  // ======== KEEP REFS IN SYNC WITH STATE ========
  useEffect(() => {
    titleRef.current = title
  }, [title])

  useEffect(() => {
    workingDirectoryRef.current = workingDirectory
  }, [workingDirectory])

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  // ======== NAVIGATION AND INITIAL LOAD ========

  // Handle navigation and focus on mount
  useEffect(() => {
    // Check for session ID in query params
    const draftId = searchParams.get('id')

    // Set sessionId from query param or null
    if (draftId) {
      setSessionId(draftId)
    }

    // Always focus title input on mount
    if (titleInputRef.current) {
      titleInputRef.current.focus()
    }
  }, []) // Run only once on mount

  // Load localStorage values once they're ready
  useEffect(() => {
    // Only apply localStorage values if:
    // 1. We don't have a session (creating new draft)
    // 2. All localStorage values have been loaded
    if (
      !session &&
      lastUsedProviderLoaded &&
      lastUsedProxyModelLoaded &&
      lastUsedProxyBaseUrlLoaded &&
      lastUsedModelLoaded
    ) {
      if (lastUsedProvider === 'anthropic' && lastUsedModel) {
        setModel(lastUsedModel)
        setProvider('anthropic')
        setProxyEnabled(false)
        setProxyBaseUrl(null)
        setProxyModelOverride(null)
      } else if (lastUsedProvider === 'openrouter' && lastUsedProxyModel && lastUsedProxyBaseUrl) {
        setModel('')
        setProvider('openrouter')
        setProxyEnabled(true)
        setProxyBaseUrl(lastUsedProxyBaseUrl)
        setProxyModelOverride(lastUsedProxyModel)
      } else if (lastUsedProvider === 'baseten') {
        // Don't require lastUsedProxyModel - it could be empty
        setModel('')
        setProvider('baseten')
        setProxyEnabled(true)
        setProxyBaseUrl(lastUsedProxyBaseUrl || 'https://inference.baseten.co/v1')
        setProxyModelOverride(lastUsedProxyModel || '')
      }
    }
  }, [
    session,
    lastUsedProvider,
    lastUsedModel,
    lastUsedProxyModel,
    lastUsedProxyBaseUrl,
    lastUsedProviderLoaded,
    lastUsedModelLoaded,
    lastUsedProxyModelLoaded,
    lastUsedProxyBaseUrlLoaded,
  ])

  // if there is no session set the value to the default, otherwise leave it at what the session specifies
  useEffect(() => {
    if (!session && defaultDangerouslyBypassPermissionsSettingChecked) {
      setDangerouslyBypassPermissionsEnabled(defaultDangerouslyBypassPermissionsSetting)
    }
  }, [session, defaultDangerouslyBypassPermissionsSettingChecked])

  useEffect(() => {
    if (!session && defaultDangerouslyBypassPermissionsSettingChecked)
      setAcceptEditsEnabled(defaultAutoAcceptEditsSetting)
  }, [session, defaultAutoAcceptEditsSettingChecked])

  // ======== DRAFT CREATION ========

  // Create draft when user starts typing (title or prompt) - stable callback with refs
  const handleCreateDraft = useCallback(async () => {
    // Check if already creating to prevent race conditions
    if (draftCreatingRef.current || sessionIdRef.current || draftCreatedRef.current) {
      return sessionIdRef.current
    }
    draftCreatingRef.current = true
    draftCreatedRef.current = true

    try {
      const response = await daemonClient.launchSession({
        query: '',
        working_dir: workingDirectoryRef.current,
        draft: true,
      })

      const newSessionId = response.sessionId
      setSessionId(newSessionId)
      sessionIdRef.current = newSessionId

      return newSessionId
    } catch (error) {
      console.error('Failed to create draft:', error)
      draftCreatedRef.current = false
      return null
    } finally {
      draftCreatingRef.current = false
    }
  }, []) // No dependencies - uses refs instead

  // Listen for editor changes and trigger draft creation if needed
  useEffect(() => {
    if (responseEditor) {
      const handleEditorUpdate = (event?: any) => {
        const content = responseEditor.getText()

        // Only trigger if we have content and no session yet
        if (content.trim() && !sessionIdRef.current && !draftCreatingRef.current) {
          handleCreateDraft()
        }
      }

      responseEditor.on('update', handleEditorUpdate)
      return () => {
        responseEditor?.off('update', handleEditorUpdate)
      }
    }
  }, [responseEditor, handleCreateDraft]) // Stable handleCreateDraft as dependency

  // ======== DRAFT UPDATES ========

  // Force immediate sync (for navigation) - uses refs for current values
  const syncImmediately = useCallback(async () => {
    const currentSessionId = sessionIdRef.current

    // Only sync if we have a valid sessionId
    if (!currentSessionId) {
      return
    }

    // Clear any pending timer
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }

    try {
      const editorStateJson = responseEditor ? JSON.stringify(responseEditor.getJSON()) : '{}'

      await daemonClient.updateSession(currentSessionId, {
        title: titleRef.current,
        workingDir: workingDirectoryRef.current,
        autoAcceptEdits: defaultAutoAcceptEditsSetting,
        dangerouslySkipPermissions: defaultDangerouslyBypassPermissionsSetting,
        editorState: editorStateJson,
        model,
        proxyEnabled,
        proxyBaseUrl: proxyBaseUrl || undefined,
        proxyModelOverride: proxyModelOverride || undefined,
      })
    } catch (error) {
      console.error('Failed to sync draft:', error)
    }
  }, [
    // Only depend on values that don't change frequently
    defaultAutoAcceptEditsSetting,
    defaultDangerouslyBypassPermissionsSetting,
    model,
    proxyEnabled,
    proxyBaseUrl,
    proxyModelOverride,
    responseEditor,
  ])

  // Sync draft to daemon (debounced) - checks sessionIdRef
  const syncToDaemon = useCallback(() => {
    // Don't sync if we don't have a valid sessionId
    if (!sessionIdRef.current) {
      return
    }

    // Clear any existing timer
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
    }

    // Set new timer for debounced sync
    syncTimerRef.current = setTimeout(async () => {
      await syncImmediately()
    }, 500)
  }, [syncImmediately]) // Only depend on stable syncImmediately

  // Watch for changes and trigger sync
  useEffect(() => {
    if (sessionId) syncToDaemon()
  }, [
    sessionId,
    title,
    workingDirectory,
    defaultAutoAcceptEditsSetting,
    defaultDangerouslyBypassPermissionsSetting,
    model,
    proxyEnabled,
    proxyBaseUrl,
    proxyModelOverride,
    // Intentionally omit syncToDaemon to avoid infinite re-renders
  ])

  // ======== RESPONSE EDITOR INTEGRATION ========

  // Handle editor content change from DraftLauncherInput - stable callback
  const handleEditorContentChange = useCallback(async () => {
    const currentSessionId = sessionIdRef.current

    if (!currentSessionId) {
      // Create draft on first content change
      const newSessionId = await handleCreateDraft()
      if (newSessionId) {
        // Sync will happen automatically via the effect
        return
      }
    }

    // If draft exists, trigger sync
    if (currentSessionId) {
      syncToDaemon()
    }
  }, [handleCreateDraft, syncToDaemon])

  // ======== USER INTERACTIONS ========

  // Handle title change - trigger draft creation or sync
  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newTitle = e.target.value
      setTitle(newTitle)
      titleRef.current = newTitle

      if (newTitle.trim() && !sessionIdRef.current) {
        handleCreateDraft()
      } else if (sessionIdRef.current) {
        syncToDaemon()
      }
    },
    [handleCreateDraft, syncToDaemon],
  )

  // Handle working directory change - trigger draft creation or sync
  const handleWorkingDirectoryChange = useCallback(
    (value: string) => {
      setWorkingDirectory(value)
      workingDirectoryRef.current = value

      if (!sessionIdRef.current && value.trim()) {
        handleCreateDraft()
      } else if (sessionIdRef.current) {
        syncToDaemon()
      }
    },
    [setWorkingDirectory, handleCreateDraft, syncToDaemon],
  )

  // Handle model/provider changes
  const handleModelChange = useCallback(
    (config: {
      model?: string
      proxyEnabled: boolean
      proxyBaseUrl?: string
      proxyModelOverride?: string
      provider: 'anthropic' | 'openrouter' | 'baseten'
    }) => {
      // Update local state with new configuration
      setModel(config.model || '')
      setProxyEnabled(config.proxyEnabled)
      setProxyBaseUrl(config.proxyBaseUrl || null)
      setProxyModelOverride(config.proxyModelOverride || null)
      setProvider(config.provider)

      // Save current configuration to localStorage for next draft
      if (config.provider === 'anthropic') {
        setLastUsedProvider('anthropic')
        setLastUsedModel(config.model || '')
        setLastUsedProxyModel('')
        setLastUsedProxyBaseUrl('')
      } else if (config.provider === 'openrouter') {
        setLastUsedProvider('openrouter')
        setLastUsedModel('')
        setLastUsedProxyModel(config.proxyModelOverride || '')
        setLastUsedProxyBaseUrl('https://openrouter.ai/api/v1')
      } else if (config.provider === 'baseten') {
        setLastUsedProvider('baseten')
        setLastUsedModel('')
        setLastUsedProxyModel(config.proxyModelOverride || '')
        setLastUsedProxyBaseUrl('https://inference.baseten.co/v1')
      }

      if (onSessionUpdated) {
        onSessionUpdated()
      }
    },
    [
      setLastUsedProvider,
      setLastUsedModel,
      setLastUsedProxyModel,
      setLastUsedProxyBaseUrl,
      onSessionUpdated,
    ],
  )

  // Handle launching a draft session
  const handleLaunchDraft = useCallback(
    async (settings: { autoAcceptEdits: boolean; dangerouslySkipPermissions: boolean }) => {
      if (isLaunchingDraft) return

      // Validate that we have a session
      if (!sessionId) {
        toast.error('No draft session to launch')
        return
      }

      const workingDir = workingDirectory
      if (!workingDir) {
        toast.error('Please select a working directory', {
          description: 'You must choose a directory before launching the session',
        })
        return
      }

      // Get the current prompt directly from the store's responseEditor
      const storeState = useStore.getState()
      const currentPrompt = storeState.responseEditor?.getText() || ''

      if (!currentPrompt.trim()) {
        toast.error('Please enter a prompt before launching')
        return
      }

      try {
        setIsLaunchingDraft(true)

        // Prepare update payload with all necessary settings
        const updatePayload: any = {
          autoAcceptEdits: settings.autoAcceptEdits,
          dangerouslySkipPermissions: settings.dangerouslySkipPermissions,
        }

        // If using Baseten, include the API key from localStorage
        if (proxyEnabled && proxyBaseUrl && proxyBaseUrl.includes('baseten.co')) {
          const basetenApiKey = localStorage.getItem('humanlayer-baseten-api-key')
          if (basetenApiKey) {
            updatePayload.proxyApiKey = basetenApiKey
          }
        }

        // If using OpenRouter, include the API key from localStorage
        if (proxyEnabled && proxyBaseUrl && proxyBaseUrl.includes('openrouter.ai')) {
          const openrouterApiKey = localStorage.getItem('humanlayer-openrouter-api-key')
          if (openrouterApiKey) {
            updatePayload.proxyApiKey = openrouterApiKey
          }
        }

        // Apply the settings to the draft session before launching
        await daemonClient.updateSession(sessionId, updatePayload)

        // Launch the draft session with the prompt
        await daemonClient.launchDraftSession(sessionId, currentPrompt)

        // Store working directory in localStorage
        localStorage.setItem('humanlayer-last-working-dir', workingDir)

        // Clear the input after successful launch
        storeState.responseEditor?.commands.setContent('')
        localStorage.removeItem(`response-input.${sessionId}`)

        // Refresh sessions to update the session list, set view mode to 'normal'
        await storeState.refreshSessions()
        await storeState.setViewMode(ViewMode.Normal)

        // Navigate directly to the launched session
        navigate(`/sessions/${sessionId}`)
      } catch (error) {
        toast.error('Failed to launch draft session', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      } finally {
        setIsLaunchingDraft(false)
      }
    },
    [sessionId, workingDirectory, isLaunchingDraft, navigate],
  )

  // Handle discard draft
  const handleDiscardDraft = useCallback(async () => {
    // Get the current prompt directly from the store's responseEditor
    const currentPrompt = useStore.getState().responseEditor?.getText() || ''

    // Check if there's any content
    const hasContent = title.trim() !== '' || currentPrompt.trim() !== ''
    if (hasContent) {
      setShowDiscardDraftDialog(true)
    } else {
      // Refresh sessions before navigating back
      await refreshSessions()
      navigate(-1)
    }
  }, [navigate, title, refreshSessions])

  const confirmDiscardDraft = useCallback(async () => {
    try {
      if (sessionId) {
        await daemonClient.deleteDraftSession(sessionId)
        localStorage.removeItem(`response-input.${sessionId}`)
        await refreshSessions()
      }
      navigate(-1)
    } catch (error) {
      toast.error('Failed to discard draft', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [sessionId, navigate, refreshSessions])

  // Handle toggling auto-accept
  const handleToggleAutoAccept = useCallback(() => {
    const newValue = !defaultAutoAcceptEditsSetting
    setAcceptEditsEnabled(newValue)
    setDefaultAutoAcceptEditsSetting(newValue)
  }, [defaultAutoAcceptEditsSetting, setDefaultAutoAcceptEditsSetting])

  // Handle toggling bypass permissions
  const handleToggleBypass = useCallback(() => {
    if (defaultDangerouslyBypassPermissionsSetting) {
      setDangerousSkipPermissionsDialogOpen(false)
      setDefaultDangerouslyBypassPermissionsSetting(false)
    } else {
      setDangerousSkipPermissionsDialogOpen(true)
    }
  }, [defaultDangerouslyBypassPermissionsSetting, setDefaultDangerouslyBypassPermissionsSetting])

  // Handle bypass dialog confirmation
  const handleDangerousSkipPermissionsConfirm = useCallback(async () => {
    setDefaultDangerouslyBypassPermissionsSetting(true)
    setDangerousSkipPermissionsDialogOpen(true)
    setDangerousSkipPermissionsDialogOpen(false)
  }, [setDefaultDangerouslyBypassPermissionsSetting])

  // ======== HOTKEYS ========

  // Escape key handler
  useHotkeys(
    'escape',
    async () => {
      if (responseEditor?.isFocused) {
        responseEditor.commands.blur()
        return
      }

      const activeElement = document.activeElement
      const isFormElementFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.tagName === 'SELECT'

      if (isFormElementFocused && activeElement instanceof HTMLElement) {
        activeElement.blur()
        return
      }

      // Sync immediately before navigating away
      await syncImmediately()
      // Refresh sessions to ensure the draft list is up to date
      await refreshSessions()
      navigate(-1)
    },
    {
      scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
      enableOnFormTags: true,
    },
    [responseEditor, navigate, syncImmediately, refreshSessions],
  )

  // Enter key to refocus the prompt input
  useHotkeys(
    'enter',
    e => {
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
      enableOnFormTags: false,
      enableOnContentEditable: false,
    },
    [responseEditor],
  )

  // 'e' key to discard draft
  useHotkeys(
    'e',
    e => {
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

  // Shift+R to focus title
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

  // Create a placeholder session for DraftLauncherInput when we don't have one yet
  const displaySession =
    session ||
    ({
      id: sessionId || null,
      status: 'draft' as any,
      query: '',
      summary: '',
      title: title,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      runId: '',
      workingDir: workingDirectory,
      model: model,
      proxyEnabled: proxyEnabled,
      proxyBaseUrl: proxyBaseUrl,
      proxyModelOverride: proxyModelOverride,
      autoAcceptEdits: defaultAutoAcceptEditsSetting,
      dangerouslySkipPermissions: defaultDangerouslyBypassPermissionsSetting,
    } as Session)

  return (
    <HotkeyScopeBoundary scope={HOTKEY_SCOPES.DRAFT_LAUNCHER} componentName="DraftLauncherForm">
      <div className="flex flex-col h-full">
        {/* Title and Directory Selection */}
        <div className="px-2">
          <div className="mb-2">
            <Label className="text-xs mb-1 uppercase tracking-wider text-muted-foreground">
              <TextSearch className="h-3 w-3 inline-block mr-1" /> title
            </Label>
            <Input
              ref={titleInputRef}
              placeholder="Describe this session..."
              className="mt-1"
              value={title}
              onChange={handleTitleChange}
            />
          </div>

          <div className="mb-2">
            <Label className="text-xs mb-1 uppercase tracking-wider text-muted-foreground">
              <FolderOpen className="h-3 w-3 inline-block mr-1" /> working directory
            </Label>
            <SearchInput
              placeholder="Select a directory to work in..."
              className="mt-1"
              recentDirectories={recentPaths}
              value={workingDirectory}
              onChange={handleWorkingDirectoryChange}
              onSubmit={value => {
                if (value) {
                  handleWorkingDirectoryChange(value)
                }
              }}
            />
          </div>

          {/* Draft Launcher Input */}
          <DraftLauncherInput
            session={displaySession}
            onLaunchDraft={handleLaunchDraft}
            onDiscardDraft={handleDiscardDraft}
            isLaunchingDraft={isLaunchingDraft}
            onModelChange={handleModelChange}
            onToggleAutoAccept={handleToggleAutoAccept}
            onToggleBypass={handleToggleBypass}
            dangerouslyBypassPermissionsEnabled={defaultDangerouslyBypassPermissionsSetting}
            autoAcceptEditsEnabled={defaultAutoAcceptEditsSetting}
            onContentChange={handleEditorContentChange}
          />
        </div>

        {/* Empty space to push content to top */}
        <div className="flex-1" />

        {/* Status indicator */}
        {sessionId &&
          (title.trim() !== '' || useStore.getState().responseEditor?.getText().trim() !== '') && (
            <div className="px-2 pb-2">
              <span className="text-xs text-muted-foreground">Draft saved • ID: {sessionId}</span>
            </div>
          )}

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
