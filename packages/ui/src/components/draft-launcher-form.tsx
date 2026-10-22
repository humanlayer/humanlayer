import type { AgentOption } from '@humanlayer/ui/constants/agents'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import type { ProviderOption } from '@humanlayer/ui/constants/providers'
import { dragCarriesFiles, readDroppedFiles } from '@humanlayer/ui/lib/dropped-files'
import { cn } from '@humanlayer/ui/lib/utils'
import { Input } from '@humanlayer/ui/components/input'
import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import { Label } from '@humanlayer/ui/components/label'
import { FolderOpen, Loader2, Send, TextSearch, X } from 'lucide-react'
import { useCallback, useRef, useState, type FC } from 'react'
import type { Content } from '@tiptap/core'
import { DraftActionButtons } from './draft-action-buttons'
import { AttachFileButton } from './action-buttons'
import { RichTextEditor, type RichTextEditorRef, type RichTextEditorProps } from './rich-text-editor'
import { StatusBar, type SessionStatus, type ModelOption, type StatusBarAgentOption } from './status-bar'
import type { ModelPickerOption } from '@humanlayer/ui/constants/models'
import type { SlashCommand } from './slash-command-list'
import { DirectorySearchInput } from './directory-search-input'
import type { PermissionsMode, PermissionsModeNoBypass } from '../constants/permission-modes'

export interface DraftLauncherFormProps {
  // Form fields
  title: string
  onTitleChange: (title: string) => void
  workingDir: string
  onWorkingDirChange: (dir: string) => void
  onWorkingDirBlur?: (path: string) => void
  workingDirectoryLabel?: string
  workingDirectoryDescription?: React.ReactNode
  /** Drops the working directory field, e.g. while the launch has no folder to show yet. */
  hideWorkingDirectory?: boolean
  content: Content | null
  onContentChange: (content: Content) => void

  // Recent directories for autocomplete
  recentDirectories?: string[]

  // Model selection
  model: ModelOption
  onModelChange: (model: ModelOption) => void
  /** Picker rows from the selected host's runtime catalog; falls back to the bundled list. */
  modelOptions?: ReadonlyArray<ModelPickerOption>

  // Agent selection
  agent?: AgentOption
  onAgentChange?: (agent: AgentOption) => void

  // Provider value retained for model filtering and launch behavior
  provider?: ProviderOption
  agentOptions?: readonly StatusBarAgentOption[]
  onAgentProviderChange?: (option: StatusBarAgentOption) => void

  // Action toggles
  bypassEnabled: boolean
  onToggleBypass: () => void
  permissionsMode: PermissionsMode
  onPermissionModeChange: (mode: PermissionsModeNoBypass) => void
  codingAgent?: CodingAgent
  bypassTimeoutMinutes: number | null

  // Status
  status?: SessionStatus
  statusText?: string

  // Submit
  onSubmit: () => void
  onDiscard?: () => void
  isSubmitting?: boolean
  submitDisabled?: boolean
  /** Key gesture that submits from the editor. */
  submitShortcut?: RichTextEditorProps['submitShortcut']
  /** Platform-aware label for the active submit shortcut. */
  submitShortcutLabel?: string

  // Upload progress
  pendingUploadCount?: number

  // Editor config
  placeholder?: string
  slashCommands?: SlashCommand[]
  /** Show hint in slash command list that other skills may be available */
  showSkillsHint?: boolean
  /** Suggestion config for @-mention file/artifact autocomplete */
  fileMentionSuggestion?: RichTextEditorProps['fileMentionSuggestion']
  editorRef?: React.RefObject<RichTextEditorRef | null>
  /** Callback when files are pasted into the editor */
  onFilePaste?: (files: File[]) => void
  /** Callback when files are dropped onto the editor area */
  onFileDrop?: (files: File[]) => void

  // Styling
  className?: string

  // Model selector controlled state (for hotkey control)
  /** Controlled open state for the model selector dropdown */
  modelSelectorOpen?: boolean
  /** Callback when the model selector open state changes */
  onModelSelectorOpenChange?: (open: boolean) => void

  // Effort selector
  /** Current effort level selection */
  effort?: string | null
  /** Callback when effort level changes */
  onEffortChange?: (next: string) => void
  /** Capability descriptor for effort */
  effortCapability?: { supported: false } | { supported: true; levels: readonly string[] }
  /** Controlled open state for the effort selector dropdown */
  effortSelectorOpen?: boolean
  /** Callback when the effort selector open state changes */
  onEffortSelectorOpenChange?: (open: boolean) => void

  // Fast Mode toggle
  /** Whether Fast Mode is enabled */
  fastMode?: boolean
  /** Callback when Fast Mode toggle changes */
  onFastModeChange?: (next: boolean) => void
  /** Capability descriptor for Fast Mode */
  fastModeCapability?: { supported: boolean }

  // Optional custom directory input component
  DirectoryInputComponent?: React.ComponentType<{
    value?: string
    onChange?: (value: string) => void
    onBlur?: (path: string) => void
    placeholder?: string
    recentDirectories?: string[]
    className?: string
    disabled?: boolean
  }>

  // Update task default working directory checkbox
  showUpdateTaskDirCheckbox?: boolean
  updateTaskDir?: boolean
  onUpdateTaskDirChange?: (checked: boolean) => void
  /** Label for the "update task dir" checkbox. Defaults to owner wording. */
  updateTaskDirCheckboxLabel?: string
}

export const DraftLauncherForm: FC<DraftLauncherFormProps> = ({
  title,
  onTitleChange,
  workingDir,
  onWorkingDirChange,
  onWorkingDirBlur,
  workingDirectoryLabel = 'working directory',
  workingDirectoryDescription,
  hideWorkingDirectory = false,
  content,
  onContentChange,
  recentDirectories = [],
  model,
  onModelChange,
  modelOptions,
  agent,
  onAgentChange,
  provider,
  agentOptions,
  onAgentProviderChange,
  bypassEnabled,
  onToggleBypass,
  permissionsMode,
  onPermissionModeChange,
  codingAgent,
  bypassTimeoutMinutes,
  status = 'draft',
  statusText,
  onSubmit,
  onDiscard,
  isSubmitting = false,
  submitDisabled = false,
  submitShortcut = 'mod+enter',
  submitShortcutLabel,
  placeholder = 'What would you like to build?',
  slashCommands = [],
  showSkillsHint = false,
  fileMentionSuggestion,
  editorRef,
  className,
  modelSelectorOpen,
  onModelSelectorOpenChange,
  effort,
  onEffortChange,
  effortCapability,
  effortSelectorOpen,
  onEffortSelectorOpenChange,
  fastMode,
  onFastModeChange,
  fastModeCapability,
  DirectoryInputComponent = DirectorySearchInput,
  showUpdateTaskDirCheckbox = false,
  updateTaskDir = false,
  onUpdateTaskDirChange,
  updateTaskDirCheckboxLabel = "Update task's default working directory",
  onFilePaste,
  onFileDrop,
  pendingUploadCount = 0,
}) => {
  const resolvedSubmitShortcutLabel =
    submitShortcutLabel ?? (submitShortcut === 'enter' ? 'Enter' : '⌘+Enter')
  const [isFocused, setIsFocused] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current += 1
      if (onFileDrop && dragCarriesFiles(e.dataTransfer)) {
        setIsDragging(true)
      }
    },
    [onFileDrop],
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounterRef.current = 0
      setIsDragging(false)
      if (!onFileDrop) return
      // Reads dataTransfer before yielding; the event's data is gone after that.
      void readDroppedFiles(e.dataTransfer).then((files) => {
        if (files.length > 0) onFileDrop(files)
      })
    },
    [onFileDrop],
  )

  return (
    <div className={cn('@container flex flex-col', className)}>
      {/* Title Input */}
      <div className="px-2 mb-2">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          <TextSearch className="h-3 w-3 inline-block mr-1" /> title
        </Label>
        <Input
          placeholder="Describe this session..."
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          disabled={isSubmitting}
          spellCheck={false}
          className="mt-1"
        />
      </div>

      {/* Working Directory */}
      {!hideWorkingDirectory && (
        <div className="px-2 mb-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            <FolderOpen className="h-3 w-3 inline-block mr-1" /> {workingDirectoryLabel}
          </Label>
          <DirectoryInputComponent
            placeholder="Select a directory to work in..."
            value={workingDir}
            onChange={onWorkingDirChange}
            onBlur={onWorkingDirBlur}
            recentDirectories={recentDirectories}
            disabled={isSubmitting}
            className="mt-1"
          />
          {workingDirectoryDescription && (
            <p className="mt-1 text-xs text-muted-foreground">{workingDirectoryDescription}</p>
          )}
        </div>
      )}

      {/* Update Task Default Working Directory Checkbox */}
      {showUpdateTaskDirCheckbox && (
        <div className="flex items-center space-x-2 px-2 mb-2">
          <Checkbox
            id="update-task-dir"
            checked={updateTaskDir}
            onCheckedChange={(checked) => onUpdateTaskDirChange?.(checked === true)}
          />
          <Label htmlFor="update-task-dir" className="text-sm text-muted-foreground cursor-pointer">
            {updateTaskDirCheckboxLabel}
          </Label>
        </div>
      )}

      {/* Draft Input Card - Compact like WUI */}
      <div className="px-2">
        <div
          className={cn(
            'border rounded-lg py-2 px-2 relative',
            isDragging && 'border-dashed border-[var(--terminal-accent)]',
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--terminal-accent)_10%,transparent)] pointer-events-none">
              <span className="text-[var(--terminal-accent)] font-mono text-sm uppercase tracking-wider">
                Drop files here
              </span>
            </div>
          )}
          <div className={cn(
            'border-l-2 pl-2 pr-2 space-y-2 transition-colors',
            isFocused ? 'border-[var(--terminal-accent)]' : 'border-transparent'
          )}>
            {/* Status Bar */}
            <StatusBar
              status={status}
              statusText={statusText}
              agent={agent}
              onAgentChange={onAgentChange}
              provider={provider}
              agentOptions={agentOptions}
              onAgentProviderChange={onAgentProviderChange}
              model={model}
              onModelChange={onModelChange}
              modelOptions={modelOptions}
              disabled={isSubmitting}
              modelSelectorOpen={modelSelectorOpen}
              onModelSelectorOpenChange={onModelSelectorOpenChange}
              effort={effort}
              onEffortChange={onEffortChange}
              effortCapability={effortCapability}
              effortSelectorOpen={effortSelectorOpen}
              onEffortSelectorOpenChange={onEffortSelectorOpenChange}
              fastMode={fastMode}
              onFastModeChange={onFastModeChange}
              fastModeCapability={fastModeCapability}
            />

            {/* Rich Text Editor */}
            <RichTextEditor
              ref={editorRef}
              value={content}
              onChange={onContentChange}
              placeholder={isFocused ? placeholder : 'ENTER to start typing...'}
              disabled={isSubmitting}
              slashCommands={slashCommands}
              showSkillsHint={showSkillsHint}
              fileMentionSuggestion={fileMentionSuggestion}
              onSubmit={onSubmit}
              submitShortcut={submitShortcut}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onFilePaste={onFilePaste}
            />

            {/* Action buttons row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <DraftActionButtons
                  bypassEnabled={bypassEnabled}
                  bypassTimeoutConfiguredMinutes={bypassTimeoutMinutes}
                  onToggleBypass={onToggleBypass}
                  permissionsMode={permissionsMode}
                  onPermissionModeChange={onPermissionModeChange}
                  codingAgent={codingAgent}
                />
                <AttachFileButton onFiles={onFileDrop!} disabled={!onFileDrop} />
              </div>

              <div className="flex items-center gap-2">
                {pendingUploadCount > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Uploading {pendingUploadCount} {pendingUploadCount === 1 ? 'file' : 'files'}...
                  </div>
                )}
                {onDiscard && (
                  <Button
                    onClick={onDiscard}
                    disabled={isSubmitting}
                    variant="secondary"
                    aria-label="Discard draft"
                    title="Discard draft (E)"
                    className="h-7 px-2 text-xs"
                  >
                    <X className="h-3.5 w-3.5 @[720px]:mr-1" />
                    <span className="hidden @[720px]:inline">
                      Discard
                      <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded border border-border">
                        E
                      </kbd>
                    </span>
                  </Button>
                )}

                <Button
                  onClick={onSubmit}
                  disabled={submitDisabled || isSubmitting}
                  variant="default"
                  aria-label={isSubmitting ? 'Launching draft' : 'Launch draft'}
                  title={
                    isSubmitting
                      ? 'Launching draft'
                      : `Launch draft (${resolvedSubmitShortcutLabel})`
                  }
                  className="h-7 px-2 text-xs"
                >
                  <Send className="h-3.5 w-3.5 @[720px]:mr-1" />
                  <span className="hidden @[720px]:inline">
                    {isSubmitting ? 'Launching...' : 'Launch'}
                    <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">
                      {resolvedSubmitShortcutLabel}
                    </kbd>
                  </span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Re-export types for convenience
export type { SlashCommand } from './slash-command-list'
export type { ModelOption, SessionStatus } from './status-bar'
export type { RichTextEditorRef } from './rich-text-editor'
