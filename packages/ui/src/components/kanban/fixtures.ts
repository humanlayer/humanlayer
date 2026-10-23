import type { KanbanColumns } from './types'

const AVATARS = {
  DW: 'https://github.com/shadcn.png',
  KH: 'https://github.com/leerob.png',
  JM: 'https://github.com/evilrabbit.png',
  AC: 'https://github.com/maxleiter.png',
}

/** Fixture columns for Storybook / visual development of the pure KanbanBoard. */
export const KANBAN_FIXTURE_COLUMNS: KanbanColumns = [
  {
    id: 'todo',
    title: 'Todo / Draft',
    cards: [
      {
        id: 'c1',
        title: 'Add OAuth2 support for GitHub',
        ageTimestampMs: Date.now() - 5 * 60 * 1000,
        ownerInitials: 'DW',
        ownerAvatarUrl: AVATARS.DW,
        workflowLabel: { name: 'rpi:todo', title: 'todo' },
        status: 'idle',
      },
      {
        id: 'c2',
        title: 'Improve error handling',
        ownerInitials: 'KH',
        ownerAvatarUrl: AVATARS.KH,
        workflowLabel: { name: 'rpi:todo', title: 'todo' },
        status: 'idle',
      },
    ],
  },
  {
    id: 'research-design',
    title: 'Research & Design',
    cards: [
      {
        id: 'c3',
        title: 'Implement kanban board',
        ageTimestampMs: Date.now() - 20 * 24 * 60 * 60 * 1000,
        ownerInitials: 'DW',
        ownerAvatarUrl: AVATARS.DW,
        workflowLabel: { name: 'rpi:design', title: 'design' },
        status: 'running',
        commentCount: 3,
        commenters: [
          { name: 'Kyle H', avatarUrl: AVATARS.KH },
          { name: 'Jamie M', avatarUrl: AVATARS.JM },
        ],
      },
      {
        id: 'c4',
        title: 'Real-time collaboration',
        ownerInitials: 'JM',
        ownerAvatarUrl: AVATARS.JM,
        workflowLabel: { name: 'rpi:research', title: 'research' },
        status: 'needs_approval',
      },
    ],
  },
  {
    id: 'planning',
    title: 'Planning',
    cards: [
      {
        id: 'c5',
        title: 'Migrate auth to WorkOS',
        ownerInitials: 'DW',
        ownerAvatarUrl: AVATARS.DW,
        workflowLabel: { name: 'rpi:plan', title: 'plan' },
        status: 'pending',
      },
      {
        id: 'c6',
        title: 'Add multi-tenant support',
        ownerInitials: 'JM',
        ownerAvatarUrl: AVATARS.JM,
        workflowLabel: { name: 'rpi:structure', title: 'structure' },
        commentCount: 5,
        commenters: [
          { name: 'Dexter W', avatarUrl: AVATARS.DW },
          { name: 'Kyle H', avatarUrl: AVATARS.KH },
          { name: 'Anna C', avatarUrl: AVATARS.AC },
        ],
      },
    ],
  },
  {
    id: 'implementation',
    title: 'Implementation',
    cards: [
      {
        id: 'c7',
        title: 'Add webhook retry mechanism',
        ageTimestampMs: Date.now() - 2 * 30 * 24 * 60 * 60 * 1000,
        ownerInitials: 'KH',
        ownerAvatarUrl: AVATARS.KH,
        workflowLabel: { name: 'rpi:implementation', title: 'implementation' },
        status: 'running',
      },
      {
        id: 'c8',
        title: 'CLI startup performance',
        ownerInitials: 'DW',
        ownerAvatarUrl: AVATARS.DW,
        workflowLabel: { name: 'rpi:implementation', title: 'implementation' },
        commentCount: 2,
        commenters: [{ name: 'Jamie M', avatarUrl: AVATARS.JM }],
      },
      {
        id: 'c-lost',
        title: 'Recover quiet agent session',
        ownerInitials: 'AC',
        ownerAvatarUrl: AVATARS.AC,
        workflowLabel: { name: 'rpi:implementation', title: 'implementation' },
        status: 'lost',
      },
    ],
  },
  {
    id: 'in-review',
    title: 'In Review',
    cards: [
      {
        id: 'c9',
        title: 'Fix session reconnection bug',
        ownerInitials: 'JM',
        ownerAvatarUrl: AVATARS.JM,
        workflowLabel: { name: 'rpi:describe-pr', title: 'describe-pr' },
      },
    ],
  },
]
