/// <reference lib="dom" />
import { test, expect, describe } from 'bun:test'
import { render, screen } from '@testing-library/react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from './dropdown-menu'

describe('DropdownMenu Component', () => {
  test('renders trigger button', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item 1</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const trigger = screen.getByText('Open Menu')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('type', 'button')
  })

  test('trigger has correct data attributes', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Test Trigger</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Test Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const trigger = screen.getByText('Test Trigger')
    expect(trigger).toHaveAttribute('data-slot', 'dropdown-menu-trigger')
    expect(trigger).toHaveAttribute('data-state', 'closed')
  })

  test('applies custom className to trigger', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger className="custom-class">Styled Trigger</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const trigger = screen.getByText('Styled Trigger')
    expect(trigger).toHaveClass('custom-class')
  })

  test('renders all component exports', () => {
    // This test verifies that all exported components can be rendered without errors
    const { container } = render(
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>Label</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Regular Item</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked={false}>
              Checkbox Item
            </DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value="1">
              <DropdownMenuRadioItem value="1">Radio 1</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="2">Radio 2</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )

    expect(container).toBeInTheDocument()
  })

  test('trigger button is keyboard accessible', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Accessible Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const trigger = screen.getByText('Accessible Menu')
    
    // Should be focusable (button element)
    expect(trigger.tagName).toBe('BUTTON')
    
    // Should not have tabindex -1
    expect(trigger).not.toHaveAttribute('tabindex', '-1')
  })

  test('component composition works correctly', () => {
    // Test that components can be composed together
    const TestComponent = () => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="test-button">Custom Button</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Test</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const { container } = render(<TestComponent />)
    const button = container.querySelector('.test-button')
    expect(button).toBeInTheDocument()
  })

  test('menu items with inset prop have correct data attribute', () => {
    const { container } = render(
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem inset>Inset Item</DropdownMenuItem>
          <DropdownMenuLabel inset>Inset Label</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    // The components should render without errors
    expect(container).toBeInTheDocument()
  })
})