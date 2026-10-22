import type { Meta, StoryObj } from '@storybook/react'
import { useState, useEffect } from 'react'
import type { Content } from '@tiptap/core'
import {
  getDefaultEffort,
  getEffortCapability,
  getFastModeCapability,
  type EffortLevel,
} from '@humanlayer/ai/config'
import type { CodingAgent } from '@humanlayer/schemas/coding-agent'
import { DraftLauncherForm, type SlashCommand, type ModelOption } from './draft-launcher-form'
import { BypassPermissionsDialog } from './bypass-permissions-dialog'
import type { PermissionsModeNoBypass } from '../constants/permission-modes'
import type { AgentOption } from '../constants/agents'
import { getModelOptionsForAgentProvider } from '../constants/models'
import type { ProviderOption } from '../constants/providers'

const MOCK_COMMANDS: SlashCommand[] = [
  { name: '/help', source: 'global' },
  { name: '/clear', source: 'global' },
  { name: '/research', source: 'local' },
  { name: '/implement', source: 'local' },
  { name: '/cl:create_plan', source: 'bundled' },
]

const meta: Meta = {
  title: 'Shell Demos/DraftLauncherForm',
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-2xl mx-auto">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj

const MOCK_RECENT_DIRECTORIES = [
  '~/go/src/github.com/humanlayer/syncopate',
  '~/go/src/github.com/humanlayer/humanlayer',
  '~/wt/syncopate/eng-2523',
]

// Full interactive wrapper with effort + fast mode support
const FormWrapper = ({
  initialTitle = '',
  initialWorkingDir = '',
  initialContent = null,
  initialModel = 'sonnet' as ModelOption,
  initialAgent = 'claude' as AgentOption,
  initialProvider = 'anthropic' as ProviderOption,
}: {
  initialTitle?: string
  initialWorkingDir?: string
  initialContent?: Content | null
  initialModel?: ModelOption
  initialAgent?: AgentOption
  initialProvider?: ProviderOption
}) => {
  const [title, setTitle] = useState(initialTitle)
  const [workingDir, setWorkingDir] = useState(initialWorkingDir)
  const [content, setContent] = useState<Content | null>(initialContent)
  const [model, setModel] = useState<ModelOption>(initialModel)
  const [agent, setAgent] = useState<AgentOption>(initialAgent)
  const [provider, setProvider] = useState<ProviderOption>(initialProvider)
  const [bypassEnabled, setBypassEnabled] = useState(false)
  const [permissionsMode, setPermissionsMode] = useState<PermissionsModeNoBypass>('default')
  const [bypassTimeout, setBypassTimeout] = useState<number | null>(15)
  const [bypassDialogOpen, setBypassDialogOpen] = useState(false)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Effort + Fast Mode state — initialize effort to the agent's default for the starting model
  const [effort, setEffort] = useState<string | undefined>(() =>
    getDefaultEffort(initialAgent as CodingAgent, initialProvider, initialModel),
  )
  const [fastMode, setFastMode] = useState(false)
  const [effortSelectorOpen, setEffortSelectorOpen] = useState(false)

  const effortCapability = getEffortCapability(agent as CodingAgent, provider, model)
  const fastModeCapability = getFastModeCapability(agent as CodingAgent, provider, model)

  // When switching models, fall back to the agent's default effort if the current value isn't supported.
  useEffect(() => {
    if (!effortCapability.supported && effort !== undefined) {
      setEffort(undefined)
      return
    }
    if (
      effortCapability.supported &&
      (effort === undefined || !(effortCapability.levels as string[]).includes(effort))
    ) {
      setEffort(getDefaultEffort(agent as CodingAgent, provider, model))
    }
  }, [model, agent, provider, effortCapability, effort])

  // Clear fastMode when switching to a non-eligible model
  useEffect(() => {
    if (!fastModeCapability.supported && fastMode) {
      setFastMode(false)
    }
  }, [model, agent, provider, fastModeCapability, fastMode])

  const handleToggleBypass = () => {
    if (bypassEnabled) {
      setBypassEnabled(false)
    } else {
      setBypassDialogOpen(true)
    }
  }

  const handleAgentChange = (nextAgent: AgentOption) => {
    const nextProvider: ProviderOption = nextAgent === 'codelayer' ? 'codex' : 'anthropic'
    const nextModel = getModelOptionsForAgentProvider({ agent: nextAgent, provider: nextProvider })[0]
    setAgent(nextAgent)
    setProvider(nextProvider)
    if (nextModel) setModel(nextModel.value)
  }

  const handleBypassConfirm = (minutes: number | null) => {
    setBypassTimeout(minutes)
    setBypassEnabled(true)
  }

  const handleSubmit = async () => {
    setIsSubmitting(true)
    await new Promise((r) => setTimeout(r, 1500))
    console.log('Submitted:', {
      title,
      workingDir,
      content,
      model,
      agent,
      provider,
      effort,
      fastMode,
      bypassEnabled,
      permissionsMode,
    })
    setIsSubmitting(false)
  }

  const isContentEmpty =
    !content ||
    (typeof content === 'object' &&
      'type' in content &&
      content.type === 'doc' &&
      (!content.content ||
        content.content.length === 0 ||
        (content.content.length === 1 &&
          content.content[0]?.type === 'paragraph' &&
          !content.content[0]?.content)))

  // Keyboard shortcut handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement
      const isFormFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.getAttribute('contenteditable') === 'true'

      // Cmd+Enter or Ctrl+Enter - launch (works even in form)
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (!isSubmitting && !(!workingDir || isContentEmpty)) {
          e.preventDefault()
          handleSubmit()
        }
      }

      // E key - discard (only when form not focused)
      if (e.key === 'e' && !isFormFocused) {
        e.preventDefault()
        setTitle('')
        setWorkingDir('')
        setContent(null)
        console.log('Draft discarded')
      }

      // Escape - blur active element
      if (e.key === 'Escape' && isFormFocused && activeElement instanceof HTMLElement) {
        activeElement.blur()
      }

      // Shift+M - toggle model selector
      if (e.shiftKey && e.key === 'M') {
        e.preventDefault()
        setModelSelectorOpen((prev) => !prev)
      }

      // Shift+E - toggle effort selector
      if (e.shiftKey && e.key === 'E' && effortCapability.supported) {
        e.preventDefault()
        setEffortSelectorOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSubmitting, workingDir, isContentEmpty, handleSubmit, effortCapability])

  return (
    <>
      <DraftLauncherForm
        title={title}
        onTitleChange={setTitle}
        workingDir={workingDir}
        onWorkingDirChange={setWorkingDir}
        content={content}
        onContentChange={setContent}
        recentDirectories={MOCK_RECENT_DIRECTORIES}
        model={model}
        onModelChange={setModel}
        agent={agent}
        onAgentChange={handleAgentChange}
        provider={provider}
        bypassEnabled={bypassEnabled}
        onToggleBypass={handleToggleBypass}
        permissionsMode={permissionsMode}
        onPermissionModeChange={setPermissionsMode}
        bypassTimeoutMinutes={bypassTimeout}
        onSubmit={handleSubmit}
        onDiscard={() => {
          setTitle('')
          setWorkingDir('')
          setContent(null)
          console.log('Draft discarded')
        }}
        isSubmitting={isSubmitting}
        submitDisabled={!workingDir || isContentEmpty}
        slashCommands={MOCK_COMMANDS}
        modelSelectorOpen={modelSelectorOpen}
        onModelSelectorOpenChange={setModelSelectorOpen}
        effort={effort}
        onEffortChange={setEffort}
        effortCapability={effortCapability}
        effortSelectorOpen={effortSelectorOpen}
        onEffortSelectorOpenChange={setEffortSelectorOpen}
        fastMode={fastMode}
        onFastModeChange={setFastMode}
        fastModeCapability={fastModeCapability}
      />
      <BypassPermissionsDialog
        open={bypassDialogOpen}
        onOpenChange={setBypassDialogOpen}
        onConfirm={handleBypassConfirm}
      />
    </>
  )
}

export const Empty: Story = {
  render: () => <FormWrapper />,
}

export const FilledOut: Story = {
  render: () => (
    <FormWrapper
      initialTitle="Add dark mode toggle"
      initialWorkingDir="/Users/dev/my-project"
      initialModel="opus"
      initialContent={{
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Please add a dark mode toggle to the settings page.',
              },
            ],
          },
        ],
      }}
    />
  ),
}

export const WithTitle: Story = {
  render: () => <FormWrapper initialTitle="Implement user authentication" />,
}

// Story demonstrating effort + fast mode with Opus 4.7 (full capability)
export const WithEffortAndFastModeOpus47: Story = {
  render: () => (
    <FormWrapper
      initialTitle="Test effort + fast mode"
      initialModel="claude-opus-4-7"
      initialAgent="claude"
      initialProvider="anthropic"
    />
  ),
}

// Story demonstrating Codex effort levels
export const WithCodexEffort: Story = {
  render: () => (
    <FormWrapper
      initialTitle="Test codex effort levels"
      initialModel="gpt-5.5"
      initialAgent="codelayer"
      initialProvider="codex"
    />
  ),
}
