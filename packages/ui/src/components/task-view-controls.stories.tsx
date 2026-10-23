import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import {
  TaskViewControls,
  type TaskViewLayout,
  type TaskViewMode,
} from './task-view-controls'
import type { UserOption } from './user-multi-select'

const FIXTURE_USERS: UserOption[] = [
  { id: 'u-dw', name: 'Dexter Williams', initials: 'DW', avatarUrl: 'https://github.com/shadcn.png' },
  { id: 'u-kh', name: 'Kyle Henderson', initials: 'KH', avatarUrl: 'https://github.com/leerob.png' },
  { id: 'u-jm', name: 'Jamie Mitchell', initials: 'JM', avatarUrl: 'https://github.com/evilrabbit.png' },
  { id: 'u-ac', name: 'Anna Chen', initials: 'AC', avatarUrl: 'https://github.com/maxleiter.png' },
]

const meta: Meta<typeof TaskViewControls> = {
  title: 'Components/TaskViewControls',
  component: TaskViewControls,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof TaskViewControls>

export const BoardEverything: Story = {
  args: {
    layout: 'board',
    mode: 'everything',
    selectedIds: new Set<string>(),
    users: FIXTURE_USERS,
    taskCount: 9,
    grouped: false,
    onLayoutChange: () => {},
    onModeChange: () => {},
    onSelectionChange: () => {},
    onGroupedChange: () => {},
  },
}

export const BoardMine: Story = {
  args: {
    ...BoardEverything.args,
    mode: 'mine',
    taskCount: 3,
  } as Story['args'],
}

export const List: Story = {
  args: {
    ...BoardEverything.args,
    layout: 'list',
    taskCount: 9,
  } as Story['args'],
}

function TaskViewControlsShellDemo() {
  const [layout, setLayout] = useState<TaskViewLayout>('board')
  const [mode, setMode] = useState<TaskViewMode>('everything')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [grouped, setGrouped] = useState(false)

  return (
    <TaskViewControls
      layout={layout}
      mode={mode}
      selectedIds={selectedIds}
      users={FIXTURE_USERS}
      taskCount={mode === 'mine' ? 3 : selectedIds.size > 0 ? selectedIds.size : 9}
      grouped={grouped}
      onLayoutChange={setLayout}
      onModeChange={(next) => {
        setMode(next)
        setSelectedIds(new Set())
      }}
      onSelectionChange={setSelectedIds}
      onGroupedChange={setGrouped}
    />
  )
}

export const Interactive: StoryObj<typeof TaskViewControlsShellDemo> = {
  name: 'Shell Demos/Interactive',
  render: () => <TaskViewControlsShellDemo />,
}
