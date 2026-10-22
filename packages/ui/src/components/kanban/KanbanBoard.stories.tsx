import type { Meta, StoryObj } from '@storybook/react'
import { KanbanBoard, KanbanCard, KanbanColumn } from './KanbanBoard'
import { KANBAN_FIXTURE_COLUMNS } from './fixtures'
import type { KanbanCard as KanbanCardModel, KanbanColumns } from './types'

const meta = {
  title: 'Components/KanbanBoard',
  component: KanbanBoard,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KanbanBoard>
export default meta

type Story = StoryObj<typeof meta>

const renderColumns = (columns: KanbanColumns) => (
  <KanbanBoard>
    {columns.map((column) => (
      <KanbanColumn key={column.id} title={column.title} count={column.cards.length}>
        {column.cards.map((card) => (
          <KanbanCard
            key={card.id}
            card={card}
            onCreateSession={null}
            onForceArchiveTask={null}
            onForceRenameTask={null}
          />
        ))}
      </KanbanColumn>
    ))}
  </KanbanBoard>
)

const baseCard: Omit<KanbanCardModel, 'id' | 'title'> = {
  ownerInitials: 'KM',
  workflowLabel: { name: 'rpi:implementation', title: 'implementation' },
  status: 'running',
}

const overflowScenarioCards: KanbanCardModel[] = [
  {
    ...baseCard,
    id: 'dotted-token',
    title: 'mercury.workflows.checkbooks.reconciliation.pipeline.with.no.break.opportunities',
  },
  {
    ...baseCard,
    id: 'single-word-token',
    title: 'SupercalifragilisticexpialidociousSupercalifragilisticexpialidociousSupercalifragilistic',
    workflowLabel: { name: 'rpi:research', title: 'research' },
  },
  {
    ...baseCard,
    id: 'path-token',
    title:
      '/Users/kylemistele/workspaces/humanlayer/apps/riptide-ui/src/components/sessions-page/WiredBoardTasksView.tsx',
    workflowLabel: { name: 'rpi:design', title: 'design' },
    commentCount: 4,
    commenters: [
      { name: 'Dexter W', avatarUrl: 'https://github.com/shadcn.png' },
      { name: 'Kyle H', avatarUrl: 'https://github.com/leerob.png' },
    ],
  },
  {
    ...baseCard,
    id: 'hyphen-token',
    title:
      'humanlayerdev-core-1498-card-text-does-not-truncate-in-kanban-columns-review-follow-up',
    workflowLabel: { name: 'rpi:describe-pr', title: 'describe-pr' },
    isUnread: true,
  },
  {
    ...baseCard,
    id: 'normal-long-title',
    title:
      'Investigate why the top card text in the In Review Kanban column wraps differently from the rest of the board',
    workflowLabel: { name: 'rpi:plan', title: 'plan' },
  },
  {
    ...baseCard,
    id: 'sentence-with-natural-breaks',
    title:
      'Review the Slack thread and confirm whether card titles should wrap naturally before clipping',
    workflowLabel: { name: 'rpi:research', title: 'research' },
  },
  {
    ...baseCard,
    id: 'mixed-natural-and-token',
    title:
      'Fix overflow in mercury.workflows.checkbooks.reconciliation after checking normal sentence wrapping',
    workflowLabel: { name: 'rpi:design', title: 'design' },
  },
  {
    ...baseCard,
    id: 'punctuated-natural-title',
    title: 'Handle long task names: wrap normal words, preserve readable punctuation, and avoid column scrollbars',
    workflowLabel: { name: 'rpi:plan', title: 'plan' },
  },
  {
    ...baseCard,
    id: 'camel-and-dotted-token',
    title: 'Investigate CheckbookReconciliationWorkflowRunner.mercury.workflows.checkbooks edge case',
    workflowLabel: { name: 'rpi:implementation', title: 'implementation' },
  },
]

const overflowScenarioColumns: KanbanColumns = [
  {
    id: 'current-config-overflow',
    title: 'Current Card CSS',
    cards: overflowScenarioCards,
  },
  {
    id: 'with-owners',
    title: 'With Avatars',
    cards: overflowScenarioCards.map((card) => ({
      ...card,
      id: `${card.id}-owners`,
      owners: [
        { initials: 'DW', avatarUrl: 'https://github.com/shadcn.png' },
        { initials: 'KH', avatarUrl: 'https://github.com/leerob.png' },
        { initials: 'JM', avatarUrl: 'https://github.com/evilrabbit.png' },
        { initials: 'AC', avatarUrl: 'https://github.com/maxleiter.png' },
      ],
    })),
  },
]

export const ReadOnly: Story = {
  render: () => renderColumns(KANBAN_FIXTURE_COLUMNS),
}

export const CurrentOverflowScenarios: Story = {
  render: () => renderColumns(overflowScenarioColumns),
}

export const CurrentOverflowScenariosNarrow: Story = {
  render: () => <div className="h-full w-[360px] overflow-auto border-r">{renderColumns(overflowScenarioColumns)}</div>,
}
