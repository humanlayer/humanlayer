import { describe, test, expect } from 'bun:test'
import type { ReactElement } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HotkeysProvider } from 'react-hotkeys-hook'
import {
  AssistantMessageContent,
  FOCUS_VIEW_CHARACTER_THRESHOLD,
} from '../ConversationStream/EventContent/AssistantMessageContent'
import { UserMessageContent } from '../ConversationStream/EventContent/UserMessageContent'

const longMessage = `${'This is a substantial assistant response. '.repeat(60)}

## Details

The focus view should render the same markdown content.

\`\`\`ts
const focused = true
\`\`\`
`

function renderWithHotkeys(ui: ReactElement) {
  return render(<HotkeysProvider initiallyActiveScopes={['*', '.']}>{ui}</HotkeysProvider>)
}

describe('Focus view modal', () => {
  test('does not render a focus button for short assistant messages', () => {
    renderWithHotkeys(<AssistantMessageContent eventContent="Short response." isThinking={false} />)

    expect(screen.queryByRole('button', { name: /open focus view/i })).not.toBeInTheDocument()
  })

  test('renders a focus button for long assistant messages', () => {
    renderWithHotkeys(
      <AssistantMessageContent
        eventContent={'x'.repeat(FOCUS_VIEW_CHARACTER_THRESHOLD)}
        isThinking={false}
      />,
    )

    expect(screen.getByRole('button', { name: /open focus view/i })).toBeInTheDocument()
  })

  test('opens the modal with rendered markdown when focus is clicked', async () => {
    renderWithHotkeys(<AssistantMessageContent eventContent={longMessage} isThinking={false} />)

    fireEvent.click(screen.getByRole('button', { name: /open focus view/i }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /focus view/i })).toBeInTheDocument()
    expect(screen.getAllByText(/the focus view should render the same markdown content/i)).toHaveLength(
      2,
    )
    expect(screen.getAllByLabelText(/copy code/i).length).toBeGreaterThanOrEqual(2)
  })

  test('closes the modal when Escape is pressed', async () => {
    renderWithHotkeys(<AssistantMessageContent eventContent={longMessage} isThinking={false} />)

    fireEvent.click(screen.getByRole('button', { name: /open focus view/i }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('restores the conversation scroll position when closed', async () => {
    const conversationContainer = document.createElement('div')
    conversationContainer.setAttribute('data-conversation-container', '')
    conversationContainer.scrollTop = 240
    document.body.appendChild(conversationContainer)

    try {
      renderWithHotkeys(<AssistantMessageContent eventContent={longMessage} isThinking={false} />)

      fireEvent.click(screen.getByRole('button', { name: /open focus view/i }))
      expect(await screen.findByRole('dialog')).toBeInTheDocument()

      conversationContainer.scrollTop = 0
      fireEvent.click(screen.getByRole('button', { name: /close/i }))

      await waitFor(() => {
        expect(conversationContainer.scrollTop).toBe(240)
      })
    } finally {
      conversationContainer.remove()
    }
  })

  test('does not render a focus button for user messages', () => {
    renderWithHotkeys(<UserMessageContent eventContent={longMessage} />)

    expect(screen.queryByRole('button', { name: /open focus view/i })).not.toBeInTheDocument()
  })
})
