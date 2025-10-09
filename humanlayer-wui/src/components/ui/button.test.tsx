/// <reference lib="dom" />
import { test, expect, describe } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { Button } from './button'

describe('Button Component - React Testing Library', () => {
  test('should render button with text', () => {
    render(<Button>Click me</Button>)

    const button = screen.getByRole('button', { name: /click me/i })
    expect(button).toBeInTheDocument()
  })

  test('should apply default variant class', () => {
    render(<Button>Default Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-accent/20', 'text-accent', 'border-accent')
  })

  test('should apply destructive variant class', () => {
    render(<Button variant="destructive">Delete</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('bg-background', 'text-destructive', 'border-destructive')
  })

  test('should apply size variant', () => {
    render(<Button size="sm">Small Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('h-8', 'px-3')
  })

  test('should be disabled when disabled prop is passed', () => {
    render(<Button disabled>Disabled Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  test('should have data-slot attribute', () => {
    render(<Button>Button with slot</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('data-slot', 'button')
  })

  test('should apply custom className', () => {
    render(<Button className="custom-class">Custom Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('custom-class')
  })
})
