import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@humanlayer/ui/components/button'
import { PaymentMethodSection } from './payment-method-section'

const meta = {
  title: 'Billing/PaymentMethodSection',
  component: PaymentMethodSection,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-[520px] rounded border border-border p-4 bg-card">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PaymentMethodSection>

export default meta

type Story = StoryObj<typeof meta>

const checkoutButton = (
  <Button size="sm" variant="secondary">
    Add Payment Method
  </Button>
)

const portalButton = (
  <Button size="sm" variant="secondary">
    Manage Billing
  </Button>
)

export const AdminWithPaymentMethod: Story = {
  args: {
    hasPaymentMethod: true,
    isOrgAdmin: true,
    paymentMethodLabel: 'Visa ending in 4242',
    primaryAction: portalButton,
    secondaryAction: checkoutButton,
  },
}

export const AdminWithoutPaymentMethod: Story = {
  args: {
    hasPaymentMethod: false,
    isOrgAdmin: true,
    primaryAction: checkoutButton,
    secondaryAction: portalButton,
  },
}

export const NonAdminReadOnly: Story = {
  args: {
    hasPaymentMethod: false,
    isOrgAdmin: false,
    primaryAction: checkoutButton,
    secondaryAction: portalButton,
  },
}
