import type { Meta, StoryObj } from '@storybook/react-vite'

import { OpenPullRequestBar } from '../../src/components/diff-review/open-pull-request-bar'

const meta = {
  title: 'Components/DiffReview/OpenPullRequestBar',
  component: OpenPullRequestBar,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[900px] border border-border/60">
        <Story />
      </div>
    ),
  ],
  args: {
    repoLabel: 'syncopate',
    branch: 'github-open-pr-cta',
    kind: 'send',
    pending: false,
    sent: false,
    error: null,
    demoted: false,
    onOpen: () => {},
    onDismiss: () => {},
  },
} satisfies Meta<typeof OpenPullRequestBar>

export default meta
type Story = StoryObj<typeof meta>

export const Send: Story = {}

/** A task page has no session, so the prompt is copied instead of sent. */
export const Copy: Story = {
  args: { kind: 'copy' },
}

/** Unsent review comments are lit in the header, so the bar goes quiet until they are gone. */
export const Demoted: Story = {
  args: { demoted: true },
}

export const Sent: Story = {
  args: { sent: true },
}

export const Failed: Story = {
  args: { error: 'Prompt could not be delivered.' },
}

/** A task working in two repositories gets a row each, told apart by the sentence. */
export const TwoRepositories: Story = {
  render: (args) => (
    <>
      <OpenPullRequestBar {...args} />
      <OpenPullRequestBar {...args} repoLabel="fold" />
    </>
  ),
}

/** GitHub is not connected: the sentence starts with the button that fixes it. Admins only. */
export const Connect: Story = {
  args: { kind: 'connect' },
}

export const ConnectDemoted: Story = {
  args: { kind: 'connect', demoted: true },
}

/** The sidebar's Changes tab: the row wraps rather than crushing the control. */
export const InTheSidebar: Story = {
  decorators: [
    (Story) => (
      <div className="w-[310px] border border-border/60">
        <Story />
      </div>
    ),
  ],
}
