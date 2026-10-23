import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from '@storybook/test'
import { useState } from 'react'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@humanlayer/ui/components/table'
import type { SessionLabel } from '@humanlayer/ui/components/session-label-badge'
import { SessionTableRow, type SessionTableRowProps } from '../session-table/SessionTableRow'
import { getSessionStatusClass, type SessionStatus, type TableSession } from '../session-table/types'

const MOCK_SESSION: TableSession = {
  id: '1',
  title: 'Implement authentication flow',
  status: 'running',
  workingDirectory: '/Users/dev/projects/myapp/src/features/auth',
  model: 'claude-sonnet-5',
  createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  lastActivityAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
}

const renderSessionStatus = (session: TableSession) => {
  return (
    <span className={getSessionStatusClass(session.status)}>
      {session.status || 'unknown'}
    </span>
  )
}

// Wrapper to provide Table context. Header order must match the cell order
// rendered by SessionTableRow / SessionTable.
const TableWrapper = ({ children }: { children: React.ReactNode }) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead className="pl-16">Status</TableHead>
        <TableHead>Title</TableHead>
        <TableHead>Labels</TableHead>
        <TableHead>Task</TableHead>
        <TableHead>Working Directory</TableHead>
        <TableHead>Updated</TableHead>
        <TableHead className="w-[40px]" />
      </TableRow>
    </TableHeader>
    <TableBody>{children}</TableBody>
  </Table>
)

// Interactive wrapper for editing demo
const EditableRow = ({ session }: { session: TableSession }) => {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title || '')

  return (
    <TableWrapper>
      <SessionTableRow
        session={session}
        isFocused={true}
        isSelected={false}
        showSelectionCheckbox={true}
        isEditing={isEditing}
        editValue={editValue}
        onEditChange={setEditValue}
        onEditSave={() => setIsEditing(false)}
        onEditCancel={() => {
          setEditValue(session.title || '')
          setIsEditing(false)
        }}
        onStartEdit={() => setIsEditing(true)}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  )
}

const meta = {
  title: 'Shell Demos/SessionTableRow',
  component: SessionTableRow as any,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-full max-w-4xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<SessionTableRowProps>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={MOCK_SESSION}
        isFocused={false}
        isSelected={false}
        showSelectionCheckbox={false}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const Focused: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={MOCK_SESSION}
        isFocused={true}
        isSelected={false}
        showSelectionCheckbox={true}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const Selected: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={MOCK_SESSION}
        isFocused={false}
        isSelected={true}
        showSelectionCheckbox={true}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const Editing: Story = {
  render: () => <EditableRow session={MOCK_SESSION} />,
}

export const WithDangerousPermissions: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{ ...MOCK_SESSION, dangerouslySkipPermissions: true }}
        isFocused={true}
        isSelected={false}
        showSelectionCheckbox={true}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const WithAutoAcceptEdits: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{ ...MOCK_SESSION, autoAcceptEdits: true }}
        isFocused={true}
        isSelected={false}
        showSelectionCheckbox={true}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const Unread: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{ ...MOCK_SESSION, isUnread: true }}
        isFocused={false}
        isSelected={false}
        showSelectionCheckbox={false}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const UnreadWithDangerousPermissions: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{ ...MOCK_SESSION, isUnread: true, dangerouslySkipPermissions: true }}
        isFocused={false}
        isSelected={false}
        showSelectionCheckbox={false}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const UnreadFailed: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{ ...MOCK_SESSION, isUnread: true, status: 'failed' }}
        isFocused={false}
        isSelected={false}
        showSelectionCheckbox={false}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const FailedStatus: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{ ...MOCK_SESSION, status: 'failed' }}
        isFocused={false}
        isSelected={false}
        showSelectionCheckbox={false}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const LostStatus: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{ ...MOCK_SESSION, status: 'lost' }}
        isFocused={false}
        isSelected={false}
        showSelectionCheckbox={false}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const Archived: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{ ...MOCK_SESSION, archived: true, status: 'ready_for_input' }}
        isFocused={false}
        isSelected={false}
        showSelectionCheckbox={false}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const AllStatuses: Story = {
  render: () => {
    const statuses: SessionStatus[] = [
      'ready_for_launch',
      'draft',
      'launching',
      'running',
      'failed',
      'lost',
      'ready_for_input',
      'needs_approval',
      'interrupt_requested',
      'interrupted',
      'resuming',
    ]
    return (
      <TableWrapper>
        {statuses.map((status) => (
          <SessionTableRow
            key={status}
            session={{ ...MOCK_SESSION, id: status, status, title: `Session with ${status} status` }}
            isFocused={false}
            isSelected={false}
            showSelectionCheckbox={false}
            isEditing={false}
            editValue=""
            onEditChange={fn()}
            onEditSave={fn()}
            onEditCancel={fn()}
            onStartEdit={fn()}
            onRowClick={fn()}
            onRowMouseEnter={fn()}
            onRowMouseLeave={fn()}
            onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
            renderSessionStatus={renderSessionStatus}
          />
        ))}
      </TableWrapper>
    )
  },
}

// Session with single label
export const WithLabel: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{ ...MOCK_SESSION, labels: [{ name: 'rpi:research', title: 'research' }] }}
        isFocused={false}
        isSelected={false}
        showSelectionCheckbox={false}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

// Session with multiple labels - shows all labels in dedicated column
export const WithMultipleLabels: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{
          ...MOCK_SESSION,
          status: 'ready_for_input',
          labels: [
            { name: 'rpi:research', title: 'research' },
            { name: 'rpi:design', title: 'design' },
            { name: 'rpi:implementation', title: 'implementation' },
          ],
        }}
        isFocused={false}
        isSelected={false}
        showSelectionCheckbox={false}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

// Multiple statuses with different labels
export const AllStatusesWithLabels: Story = {
  render: () => {
    const statusesWithLabels: Array<{ status: SessionStatus; label: SessionLabel }> = [
      { status: 'running', label: { name: 'rpi:research', title: 'research' } },
      { status: 'ready_for_input', label: { name: 'rpi:design', title: 'design' } },
      { status: 'interrupted', label: { name: 'rpi:implementation', title: 'implementation' } },
      { status: 'failed', label: { name: 'rpi:plan', title: 'plan' } },
      { status: 'lost', label: { name: 'rpi:implementation', title: 'implementation' } },
    ]
    return (
      <TableWrapper>
        {statusesWithLabels.map(({ status, label }) => (
          <SessionTableRow
            key={status}
            session={{ ...MOCK_SESSION, id: status, status, labels: [label] }}
            isFocused={false}
            isSelected={false}
            showSelectionCheckbox={false}
            isEditing={false}
            editValue=""
            onEditChange={fn()}
            onEditSave={fn()}
            onEditCancel={fn()}
            onStartEdit={fn()}
            onRowClick={fn()}
            onRowMouseEnter={fn()}
            onRowMouseLeave={fn()}
            onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
            renderSessionStatus={renderSessionStatus}
          />
        ))}
      </TableWrapper>
    )
  },
}

export const WithActionMenu: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={MOCK_SESSION}
        isFocused={true}
        isSelected={false}
        showSelectionCheckbox={true}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}

export const WithBypassActive: Story = {
  render: () => (
    <TableWrapper>
      <SessionTableRow
        session={{ ...MOCK_SESSION, dangerouslySkipPermissions: true }}
        isFocused={true}
        isSelected={false}
        showSelectionCheckbox={true}
        isEditing={false}
        editValue=""
        onEditChange={fn()}
        onEditSave={fn()}
        onEditCancel={fn()}
        onStartEdit={fn()}
        onRowClick={fn()}
        onRowMouseEnter={fn()}
        onRowMouseLeave={fn()}
        onToggleSelection={fn()}
        onOpenArchiveDialog={fn()}
        onOpenBypassDialog={fn()}
        renderSessionStatus={renderSessionStatus}
      />
    </TableWrapper>
  ),
}
