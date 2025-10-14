import { useForm } from '@tanstack/react-form'
import { zodValidator } from '@tanstack/zod-form-adapter'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Session, SessionStatus, ViewMode } from '@/lib/daemon/types'
import { useStore } from '@/AppStore'
import { draftSessionSchema, DraftSessionFormValues } from '../types/draft'
import { getDraftLauncherDefaults, DRAFT_LAUNCHER_PREFS } from '@/lib/preferences'
import { LAST_WORKING_DIR_KEY } from '@/hooks/useSessionLauncher'
import { DraftLauncherInput } from './DraftLauncherInput'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchInput } from '@/components/FuzzySearchInput'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { TextSearch, FolderOpen } from 'lucide-react'
import { DangerouslySkipPermissionsDialog } from '../DangerouslySkipPermissionsDialog'
import { DiscardDraftDialog } from './DiscardDraftDialog'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { daemonClient } from '@/lib/daemon'

interface DraftSessionFormProps {
  existingDraft?: Session | null
  onClose: () => void
  onLaunch: (sessionId: string) => void
}

export function DraftSessionForm({ existingDraft, onClose, onLaunch }: DraftSessionFormProps) {
  const [draftId, setDraftId] = useState<string | null>(existingDraft?.id || null)
  const [draftSession, setDraftSession] = useState<Session | null>(existingDraft || null)
  const [isLaunchingDraft, setIsLaunchingDraft] = useState(false)
  const [showDiscardDraftDialog, setShowDiscardDraftDialog] = useState(false)
  const [dangerousSkipPermissionsDialogOpen, setDangerousSkipPermissionsDialogOpen] = useState(false)

  const titleInputRef = useRef<HTMLInputElement>(null)
  const responseEditor = useStore(state => state.responseEditor)
  const refreshSessions = useStore(state => state.refreshSessions)
  const setViewMode = useStore(state => state.setViewMode)
  const defaults = getDraftLauncherDefaults()
  const { paths: recentPaths } = useRecentPaths()

  // Local storage for settings that persist across drafts
  const [autoAcceptEnabled, setAutoAcceptEnabled] = useLocalStorage(
    'draft-auto-accept',
    existingDraft?.autoAcceptEdits ?? defaults.autoAccept,
  )
  const [bypassEnabled, setBypassEnabled] = useLocalStorage(
    'draft-bypass-permissions',
    existingDraft?.dangerouslySkipPermissions ?? defaults.bypassPermissions,
  )

  // Track initial values to detect changes
  const [initialAutoAccept] = useState(autoAcceptEnabled)
  const [initialBypass] = useState(bypassEnabled)
  const [initialWorkingDir] = useState(existingDraft?.workingDir || '')

  // Initialize form with TanStack Form
  const form = useForm<DraftSessionFormValues>({
    defaultValues: {
      title: existingDraft?.title || existingDraft?.summary || '',
      prompt: '', // Will be synced from ResponseEditor
      workingDirectory: existingDraft?.workingDir || localStorage.getItem(LAST_WORKING_DIR_KEY) || '',
      autoAcceptEdits: autoAcceptEnabled,
      dangerouslySkipPermissions: bypassEnabled,
    },
    validatorAdapter: zodValidator(),
    validators: {
      onChange: draftSessionSchema,
    },
    onSubmit: async ({ value }) => {
      await handleLaunchDraft(value)
    },
  })

  // Subscribe to form dirty state - use state property directly
  const isDirty = form.state.isDirty
  const values = form.state.values

  // Determine if we should create a draft
  const shouldCreateDraft = useCallback(() => {
    const hasContent = values.title.trim() !== '' || values.prompt.trim() !== ''
    const hasChangedSettings =
      values.autoAcceptEdits !== defaults.autoAccept ||
      values.dangerouslySkipPermissions !== defaults.bypassPermissions ||
      (values.workingDirectory && values.workingDirectory !== initialWorkingDir)

    return hasContent || hasChangedSettings
  }, [values, defaults, initialWorkingDir])

  // Create draft when form becomes dirty (lazy creation)
  useEffect(() => {
    if (!draftId && shouldCreateDraft()) {
      const createDraft = async () => {
        try {
          const response = await daemonClient.launchSession({
            query: '',
            working_dir: values.workingDirectory || '~/',
            draft: true,
          })
          setDraftId(response.sessionId)

          // Fetch the created draft session
          const sessions = await daemonClient.listSessions()
          const newDraft = sessions.find(s => s.id === response.sessionId)
          if (newDraft) {
            setDraftSession(newDraft)
          }

          await refreshSessions()
        } catch (error) {
          console.error('Failed to create draft:', error)
          toast.error('Failed to create draft session')
        }
      }
      createDraft()
    }
  }, [shouldCreateDraft, draftId, values.workingDirectory, refreshSessions])

  // Sync form changes to daemon for existing draft
  useEffect(() => {
    if (draftId && isDirty && draftSession) {
      const syncDraft = async () => {
        try {
          await daemonClient.updateSession(draftId, {
            title: values.title,
            workingDir: values.workingDirectory,
            autoAcceptEdits: values.autoAcceptEdits,
            dangerouslySkipPermissions: values.dangerouslySkipPermissions,
          })
        } catch (error) {
          console.error('Failed to sync draft:', error)
        }
      }

      const timeoutId = setTimeout(syncDraft, 500) // Debounce
      return () => clearTimeout(timeoutId)
    }
  }, [values, draftId, isDirty, draftSession])

  // Sync ResponseEditor content to form
  useEffect(() => {
    if (!responseEditor) return

    const handleUpdate = () => {
      // Get the editor content and process mentions/slash commands properly
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

      const content = processNode(json)
      form.setFieldValue('prompt', content)
    }

    responseEditor.on('update', handleUpdate)
    return () => {
      responseEditor.off('update', handleUpdate)
    }
  }, [responseEditor, form])

  const handleLaunchDraft = async (values: DraftSessionFormValues) => {
    if (!values.prompt.trim()) {
      toast.error('Please enter a prompt before launching')
      return
    }

    if (!values.workingDirectory.trim()) {
      toast.error('Please select a working directory')
      return
    }

    try {
      setIsLaunchingDraft(true)

      // Update localStorage preferences
      localStorage.setItem(LAST_WORKING_DIR_KEY, values.workingDirectory)
      localStorage.setItem(DRAFT_LAUNCHER_PREFS.AUTO_ACCEPT, String(values.autoAcceptEdits))
      localStorage.setItem(
        DRAFT_LAUNCHER_PREFS.BYPASS_PERMISSIONS,
        String(values.dangerouslySkipPermissions),
      )

      // Launch the draft
      if (draftId) {
        // Apply the settings before launching
        await daemonClient.updateSession(draftId, {
          autoAcceptEdits: values.autoAcceptEdits,
          dangerouslySkipPermissions: values.dangerouslySkipPermissions,
        })

        await daemonClient.launchDraftSession(draftId, values.prompt)
        await refreshSessions()
        await setViewMode(ViewMode.Normal)
        onLaunch(draftId)
      } else {
        // Create and launch in one go
        const response = await daemonClient.launchSession({
          query: values.prompt,
          working_dir: values.workingDirectory,
          draft: false, // Launch directly
        })
        await refreshSessions()
        await setViewMode(ViewMode.Normal)
        onLaunch(response.sessionId)
      }

      // Clear the input after successful launch
      responseEditor?.commands.setContent('')
      if (draftId) {
        localStorage.removeItem(`response-input.${draftId}`)
      }
    } catch (error) {
      console.error('Failed to launch draft:', error)
      toast.error('Failed to launch session')
    } finally {
      setIsLaunchingDraft(false)
    }
  }

  // Handle title changes
  const handleTitleChange = useCallback(
    async (newTitle: string) => {
      form.setFieldValue('title', newTitle)

      if (draftId) {
        try {
          await daemonClient.updateSessionTitle(draftId, newTitle)
          useStore.getState().updateSession(draftId, { title: newTitle })
        } catch (error) {
          toast.error('Failed to update session title')
        }
      }
    },
    [draftId, form],
  )

  // Handle directory changes
  const handleDirectoryChange = useCallback(
    async (newDirectory: string) => {
      form.setFieldValue('workingDirectory', newDirectory)

      if (draftId && newDirectory && newDirectory !== draftSession?.workingDir) {
        try {
          await daemonClient.updateSession(draftId, {
            workingDir: newDirectory,
          })
          useStore.getState().updateSession(draftId, { workingDir: newDirectory })
          setDraftSession(prev => (prev ? { ...prev, workingDir: newDirectory } : null))
        } catch (error) {
          toast.error('Failed to update working directory')
          // Revert on error
          form.setFieldValue('workingDirectory', draftSession?.workingDir || '')
        }
      }
    },
    [draftId, draftSession, form],
  )

  // Handle discard draft
  const handleDiscardDraft = useCallback(() => {
    // Check if there are any changes to the draft
    let hasChanges = false

    // Check if title has been set
    if (values.title && values.title.trim() !== '') {
      hasChanges = true
    }

    // Check if prompt draft is non-empty
    if (values.prompt && values.prompt.trim() !== '') {
      hasChanges = true
    }

    // Check if working directory has been changed
    if (values.workingDirectory !== initialWorkingDir) {
      hasChanges = true
    }

    // Check if settings have been changed
    if (
      values.autoAcceptEdits !== initialAutoAccept ||
      values.dangerouslySkipPermissions !== initialBypass
    ) {
      hasChanges = true
    }

    if (hasChanges) {
      setShowDiscardDraftDialog(true)
    } else {
      onClose()
    }
  }, [values, initialWorkingDir, initialAutoAccept, initialBypass, onClose])

  const confirmDiscardDraft = useCallback(async () => {
    try {
      if (draftId) {
        // Delete the draft session
        await daemonClient.deleteDraftSession(draftId)
        localStorage.removeItem(`response-input.${draftId}`)
        await refreshSessions()
      }
      onClose()
    } catch (error) {
      toast.error('Failed to discard draft')
    }
  }, [draftId, refreshSessions, onClose])

  // Handle toggling auto-accept
  const handleToggleAutoAccept = useCallback(() => {
    const newValue = !values.autoAcceptEdits
    form.setFieldValue('autoAcceptEdits', newValue)
    setAutoAcceptEnabled(newValue)
  }, [values.autoAcceptEdits, form, setAutoAcceptEnabled])

  // Handle toggling bypass permissions
  const handleToggleBypass = useCallback(() => {
    if (values.dangerouslySkipPermissions) {
      // If currently enabled, disable it directly
      form.setFieldValue('dangerouslySkipPermissions', false)
      setBypassEnabled(false)
    } else {
      // If currently disabled, show the modal to confirm enabling
      setDangerousSkipPermissionsDialogOpen(true)
    }
  }, [values.dangerouslySkipPermissions, form, setBypassEnabled])

  // Handle bypass dialog confirmation
  const handleDangerousSkipPermissionsConfirm = useCallback(async () => {
    form.setFieldValue('dangerouslySkipPermissions', true)
    setBypassEnabled(true)
    setDangerousSkipPermissionsDialogOpen(false)
  }, [form, setBypassEnabled])

  // Handle model change callback
  const handleModelChange = useCallback(() => {
    // Trigger any necessary updates when model changes
    if (draftSession) {
      setDraftSession({ ...draftSession })
    }
  }, [draftSession])

  // Handle launch from DraftLauncherInput
  const handleLaunchFromInput = useCallback(
    async (settings: { autoAcceptEdits: boolean; dangerouslySkipPermissions: boolean }) => {
      form.setFieldValue('autoAcceptEdits', settings.autoAcceptEdits)
      form.setFieldValue('dangerouslySkipPermissions', settings.dangerouslySkipPermissions)
      await form.handleSubmit()
    },
    [form],
  )

  // Hotkeys - Escape to close/blur
  useHotkeys(
    'escape',
    () => {
      if (responseEditor?.isFocused) {
        responseEditor.commands.blur()
      } else {
        const activeElement = document.activeElement
        const isFormElementFocused =
          activeElement?.tagName === 'INPUT' ||
          activeElement?.tagName === 'TEXTAREA' ||
          activeElement?.tagName === 'SELECT'

        if (isFormElementFocused && activeElement instanceof HTMLElement) {
          activeElement.blur()
        } else {
          onClose()
        }
      }
    },
    {
      scopes: [HOTKEY_SCOPES.DRAFT_LAUNCHER],
      enableOnFormTags: true,
      preventDefault: true,
    },
    [responseEditor, onClose],
  )

  // Auto-focus title on mount
  useEffect(() => {
    if (titleInputRef.current) {
      titleInputRef.current.focus()
    }
  }, [])

  return (
    <HotkeyScopeBoundary scope={HOTKEY_SCOPES.DRAFT_LAUNCHER} componentName="DraftSessionForm">
      <div className="flex flex-col h-full">
        {/* Title and Directory inputs */}
        <div className="px-2">
          <div className="mb-2">
            <Label className="text-xs mb-1 uppercase tracking-wider text-muted-foreground">
              <TextSearch className="h-3 w-3 inline-block mr-1" /> title
            </Label>
            <Input
              ref={titleInputRef}
              placeholder="Describe this session..."
              className="mt-1"
              value={values.title}
              onChange={e => handleTitleChange(e.target.value)}
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
              value={values.workingDirectory}
              onChange={handleDirectoryChange}
              onSubmit={value => value && handleDirectoryChange(value)}
            />
          </div>

          {/* Draft Launcher Input with ResponseEditor */}
          <DraftLauncherInput
            session={
              draftSession ||
              ({
                id: draftId || 'temp',
                status: SessionStatus.Draft,
                query: '',
                createdAt: new Date(),
                lastActivityAt: new Date(),
                runId: '',
                workingDir: values.workingDirectory,
              } as Session)
            }
            onLaunchDraft={handleLaunchFromInput}
            onDiscardDraft={handleDiscardDraft}
            isLaunchingDraft={isLaunchingDraft}
            onModelChange={handleModelChange}
            autoAcceptEnabled={values.autoAcceptEdits}
            bypassEnabled={values.dangerouslySkipPermissions}
            onToggleAutoAccept={handleToggleAutoAccept}
            onToggleBypass={handleToggleBypass}
          />
        </div>

        {/* Empty space to push content to top */}
        <div className="flex-1" />

        {/* Status indicator */}
        {isDirty && draftId && (
          <div className="px-2 pb-2">
            <span className="text-xs text-muted-foreground">Draft saved</span>
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
