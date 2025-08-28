import type { Meta, StoryObj } from '@storybook/react'
import { fn } from '@storybook/test'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select'
import { Label } from './label'
import { User, Globe, Smartphone } from 'lucide-react'

const meta: Meta<typeof Select> = {
  title: 'UI/Select',
  component: Select,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    disabled: {
      control: 'boolean',
    },
    required: {
      control: 'boolean',
    },
  },
  args: {
    onValueChange: fn(),
    onOpenChange: fn(),
  },
}

export default meta
type Story = StoryObj<typeof meta>

// Basic select
export const Default: Story = {
  render: args => (
    <Select {...args}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
        <SelectItem value="cherry">Cherry</SelectItem>
        <SelectItem value="grape">Grape</SelectItem>
        <SelectItem value="orange">Orange</SelectItem>
      </SelectContent>
    </Select>
  ),
}

export const WithDefaultValue: Story = {
  render: args => (
    <Select defaultValue="banana" {...args}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
        <SelectItem value="cherry">Cherry</SelectItem>
        <SelectItem value="grape">Grape</SelectItem>
        <SelectItem value="orange">Orange</SelectItem>
      </SelectContent>
    </Select>
  ),
}

// Size variants
export const SmallSize: Story = {
  render: args => (
    <Select {...args}>
      <SelectTrigger size="sm" className="w-[160px]">
        <SelectValue placeholder="Small select" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="xs">Extra Small</SelectItem>
        <SelectItem value="sm">Small</SelectItem>
        <SelectItem value="md">Medium</SelectItem>
        <SelectItem value="lg">Large</SelectItem>
      </SelectContent>
    </Select>
  ),
}

export const DefaultSize: Story = {
  render: args => (
    <Select {...args}>
      <SelectTrigger size="default" className="w-[180px]">
        <SelectValue placeholder="Default select" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="xs">Extra Small</SelectItem>
        <SelectItem value="sm">Small</SelectItem>
        <SelectItem value="md">Medium</SelectItem>
        <SelectItem value="lg">Large</SelectItem>
      </SelectContent>
    </Select>
  ),
}

// With groups and labels
export const WithGroups: Story = {
  render: args => (
    <Select {...args}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select a technology" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Frontend</SelectLabel>
          <SelectItem value="react">React</SelectItem>
          <SelectItem value="vue">Vue.js</SelectItem>
          <SelectItem value="angular">Angular</SelectItem>
          <SelectItem value="svelte">Svelte</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Backend</SelectLabel>
          <SelectItem value="nodejs">Node.js</SelectItem>
          <SelectItem value="python">Python</SelectItem>
          <SelectItem value="java">Java</SelectItem>
          <SelectItem value="golang">Go</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Database</SelectLabel>
          <SelectItem value="postgresql">PostgreSQL</SelectItem>
          <SelectItem value="mysql">MySQL</SelectItem>
          <SelectItem value="mongodb">MongoDB</SelectItem>
          <SelectItem value="redis">Redis</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  ),
}

// With icons
export const WithIcons: Story = {
  render: args => (
    <Select {...args}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select account type" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="personal">
          <User className="mr-2 h-4 w-4" />
          Personal
        </SelectItem>
        <SelectItem value="business">
          <Globe className="mr-2 h-4 w-4" />
          Business
        </SelectItem>
        <SelectItem value="mobile">
          <Smartphone className="mr-2 h-4 w-4" />
          Mobile
        </SelectItem>
      </SelectContent>
    </Select>
  ),
}

// Disabled states
export const Disabled: Story = {
  render: args => (
    <Select disabled {...args}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Disabled select" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="option1">Option 1</SelectItem>
        <SelectItem value="option2">Option 2</SelectItem>
        <SelectItem value="option3">Option 3</SelectItem>
      </SelectContent>
    </Select>
  ),
}

export const DisabledWithValue: Story = {
  render: args => (
    <Select disabled defaultValue="option2" {...args}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Disabled select" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="option1">Option 1</SelectItem>
        <SelectItem value="option2">Option 2</SelectItem>
        <SelectItem value="option3">Option 3</SelectItem>
      </SelectContent>
    </Select>
  ),
}

// Disabled individual items
export const WithDisabledItems: Story = {
  render: args => (
    <Select {...args}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Some options disabled" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="available">Available</SelectItem>
        <SelectItem value="disabled1" disabled>
          Disabled Option
        </SelectItem>
        <SelectItem value="available2">Available Too</SelectItem>
        <SelectItem value="disabled2" disabled>
          Also Disabled
        </SelectItem>
        <SelectItem value="available3">Still Available</SelectItem>
      </SelectContent>
    </Select>
  ),
}

// With label
export const WithLabel: Story = {
  render: args => (
    <div className="space-y-2">
      <Label htmlFor="select-with-label">Choose your country</Label>
      <Select {...args}>
        <SelectTrigger id="select-with-label" className="w-[200px]">
          <SelectValue placeholder="Select country" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="us">United States</SelectItem>
          <SelectItem value="uk">United Kingdom</SelectItem>
          <SelectItem value="ca">Canada</SelectItem>
          <SelectItem value="au">Australia</SelectItem>
          <SelectItem value="de">Germany</SelectItem>
          <SelectItem value="fr">France</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
}

// Required field
export const Required: Story = {
  render: args => (
    <div className="space-y-2">
      <Label htmlFor="required-select">
        Priority Level
        <span className="text-destructive ml-1">*</span>
      </Label>
      <Select required {...args}>
        <SelectTrigger id="required-select" className="w-[180px]">
          <SelectValue placeholder="Select priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="low">Low</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="urgent">Urgent</SelectItem>
        </SelectContent>
      </Select>
    </div>
  ),
}

// Long content
export const LongContent: Story = {
  render: args => (
    <Select {...args}>
      <SelectTrigger className="w-[300px]">
        <SelectValue placeholder="Select with long options" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="short">Short</SelectItem>
        <SelectItem value="medium">Medium length option</SelectItem>
        <SelectItem value="long">This is a very long option that demonstrates text wrapping</SelectItem>
        <SelectItem value="very-long">
          This is an extremely long option text that shows how the component handles very lengthy
          content that might overflow
        </SelectItem>
        <SelectItem value="normal">Back to normal</SelectItem>
      </SelectContent>
    </Select>
  ),
}

// Scrollable content
export const ScrollableContent: Story = {
  render: args => (
    <Select {...args}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Many options" />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 20 }, (_, i) => (
          <SelectItem key={i} value={`option-${i + 1}`}>
            Option {i + 1}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ),
}

// Form example
export const FormExample: Story = {
  render: () => (
    <div className="space-y-4 w-80">
      <div className="space-y-2">
        <Label htmlFor="role-select">
          Role
          <span className="text-destructive ml-1">*</span>
        </Label>
        <Select>
          <SelectTrigger id="role-select">
            <SelectValue placeholder="Select your role" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Engineering</SelectLabel>
              <SelectItem value="frontend">Frontend Developer</SelectItem>
              <SelectItem value="backend">Backend Developer</SelectItem>
              <SelectItem value="fullstack">Full Stack Developer</SelectItem>
              <SelectItem value="devops">DevOps Engineer</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Design</SelectLabel>
              <SelectItem value="ux">UX Designer</SelectItem>
              <SelectItem value="ui">UI Designer</SelectItem>
              <SelectItem value="graphic">Graphic Designer</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Management</SelectLabel>
              <SelectItem value="pm">Product Manager</SelectItem>
              <SelectItem value="em">Engineering Manager</SelectItem>
              <SelectItem value="dm">Design Manager</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="experience-select">Experience Level</Label>
        <Select>
          <SelectTrigger id="experience-select">
            <SelectValue placeholder="Select experience" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="entry">Entry Level (0-2 years)</SelectItem>
            <SelectItem value="mid">Mid Level (3-5 years)</SelectItem>
            <SelectItem value="senior">Senior Level (6-10 years)</SelectItem>
            <SelectItem value="lead">Lead Level (10+ years)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  ),
}

// Validation state
export const InvalidState: Story = {
  render: args => (
    <div className="space-y-2">
      <Label htmlFor="invalid-select">
        Required Field
        <span className="text-destructive ml-1">*</span>
      </Label>
      <Select {...args}>
        <SelectTrigger id="invalid-select" className="w-[200px]" aria-invalid>
          <SelectValue placeholder="Please select an option" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="option1">Option 1</SelectItem>
          <SelectItem value="option2">Option 2</SelectItem>
          <SelectItem value="option3">Option 3</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-sm text-destructive">This field is required</p>
    </div>
  ),
}
