import type { Meta, StoryObj } from '@storybook/react'
import { MCPToolCallParamPreview } from './MCPToolCallParamPreview'

const meta = {
  title: 'Internal/ConversationStream/MCPToolCallParamPreview',
  component: MCPToolCallParamPreview,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    Story => (
      <div
        style={{
          backgroundColor: '#0a0a0a',
          minHeight: '100vh',
          padding: '2rem',
        }}
      >
        <div
          style={{
            maxWidth: '800px',
            backgroundColor: '#1a1a1a',
            padding: '1.5rem',
            border: '1px solid #333',
            borderRadius: '8px',
          }}
        >
          <Story />
        </div>
      </div>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof MCPToolCallParamPreview>

export default meta
type Story = StoryObj<typeof meta>

export const SimpleObject: Story = {
  args: {
    toolInput: {
      name: 'John Doe',
      age: 30,
      email: 'john@example.com',
      role: 'developer',
    },
  },
}

export const ObjectExceedingLimit: Story = {
  args: {
    toolInput: {
      id: '12345',
      name: 'John Doe',
      email: 'john@example.com',
      age: 30,
      role: 'developer',
      department: 'Engineering',
      location: 'San Francisco',
      startDate: '2020-01-15',
      salary: 120000,
      manager: 'Jane Smith',
    },
    attributeLimit: 5,
  },
}

export const ArrayOfObjects: Story = {
  args: {
    toolInput: [
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        age: 28,
        role: 'engineer',
      },
      {
        id: 2,
        name: 'Bob',
        email: 'bob@example.com',
        age: 32,
        role: 'designer',
      },
      {
        id: 3,
        name: 'Charlie',
        email: 'charlie@example.com',
        age: 45,
        role: 'manager',
      },
    ],
  },
}

export const ArrayOfObjectsExceedingLimit: Story = {
  args: {
    toolInput: [
      {
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        age: 28,
        role: 'engineer',
        department: 'Backend',
        location: 'NYC',
        experience: 5,
      },
      {
        id: 2,
        name: 'Bob',
        email: 'bob@example.com',
        age: 32,
        role: 'designer',
      },
    ],
    attributeLimit: 5,
  },
}

export const ArrayOfPrimitives: Story = {
  args: {
    toolInput: ['apple', 'banana', 'cherry', 'date'],
  },
}

export const ArrayOfPrimitivesLong: Story = {
  args: {
    toolInput: ['apple', 'banana', 'cherry', 'date', 'elderberry', 'fig', 'grape', 'honeydew'],
  },
}

export const NestedObjectsAndArrays: Story = {
  args: {
    toolInput: {
      name: 'Project Alpha',
      team: ['Alice', 'Bob', 'Charlie'],
      metadata: {
        created: '2024-01-01',
        updated: '2024-10-01',
      },
      stats: {
        commits: 152,
        contributors: 8,
      },
      tags: ['urgent', 'backend', 'api'],
    },
  },
}

export const SinglePrimitive: Story = {
  args: {
    toolInput: 'Hello, World!',
  },
}

export const SingleNumber: Story = {
  args: {
    toolInput: 42,
  },
}

export const SingleBoolean: Story = {
  args: {
    toolInput: true,
  },
}

export const EmptyArray: Story = {
  args: {
    toolInput: [],
  },
}

export const EmptyObject: Story = {
  args: {
    toolInput: {},
  },
}

export const ComplexNested: Story = {
  args: {
    toolInput: {
      query: 'search term',
      filters: {
        category: 'electronics',
        priceRange: [100, 500],
      },
      options: {
        sort: 'price',
        limit: 20,
      },
      metadata: {
        timestamp: '2024-10-01T10:00:00Z',
        requestId: 'abc-123',
      },
    },
  },
}

export const ArrayWithNestedFirstItem: Story = {
  args: {
    toolInput: [
      {
        id: 1,
        name: 'Item 1',
        details: {
          color: 'red',
          size: 'large',
        },
        tags: ['new', 'featured'],
        price: 99.99,
        inStock: true,
      },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' },
    ],
  },
}

export const CustomAttributeLimit: Story = {
  args: {
    toolInput: {
      field1: 'value1',
      field2: 'value2',
      field3: 'value3',
      field4: 'value4',
      field5: 'value5',
      field6: 'value6',
      field7: 'value7',
    },
    attributeLimit: 3,
  },
}

export const NullAndUndefinedValues: Story = {
  args: {
    toolInput: {
      name: 'Test',
      nullValue: null,
      numberValue: 0,
      booleanValue: false,
      stringValue: '',
    },
  },
}
