import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Byline } from './Avatar'

afterEach(cleanup)

describe('Byline', () => {
	it('shows a person with their avatar', () => {
		const { container } = render(<Byline name="Ada Lovelace" src="https://example.com/ada.png" agent={false} />)
		expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
		expect(container.querySelectorAll('.avatar')).toHaveLength(1)
		expect(container.querySelector('.avatar-stack')).toBeNull()
	})
	it("stacks the HumanLayer mark on the person for their agent's comments", () => {
		const { container } = render(<Byline name="Ada Lovelace" agent />)
		expect(screen.getByText("Ada Lovelace's agent")).toBeInTheDocument()
		expect(container.querySelector('.avatar-stack')).toHaveAttribute('title', "Ada Lovelace's agent")
		expect(container.querySelectorAll('.avatar-stack .avatar')).toHaveLength(2)
	})
})
