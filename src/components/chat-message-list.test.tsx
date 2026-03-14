import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatMessageList } from './chat-message-list'

describe('ChatMessageList', () => {
  it('renders empty state when no messages are present', () => {
    render(<ChatMessageList loading={false} messages={[]} />)

    expect(screen.getByText('No messages yet.')).toBeInTheDocument()
  })

  it('renders system, admin, and deleted messages with the expected affordances', () => {
    const handleAdminAction = vi.fn()

    render(
      <ChatMessageList
        loading={false}
        onAdminAction={handleAdminAction}
        messages={[
          {
            id: 1,
            nickname: 'system',
            body: 'user noisyuser has been banned',
          },
          {
            id: 2,
            nickname: 'andromedatv',
            body: 'please keep it civil',
            is_admin: true,
          },
          {
            id: 3,
            nickname: 'viewer1',
            body: 'message deleted',
          },
        ]}
      />,
    )

    expect(screen.getByText('system')).toBeInTheDocument()
    expect(screen.getByText('user noisyuser has been banned')).toBeInTheDocument()
    expect(screen.getByText('andromedatv')).toBeInTheDocument()
    expect(screen.getAllByText('message deleted')).toHaveLength(1)

    const actionButtons = screen.getAllByRole('button', {
      name: 'Message admin actions',
    })
    expect(actionButtons).toHaveLength(3)

    fireEvent.click(actionButtons[1]!)
    expect(handleAdminAction).toHaveBeenCalledWith(2, 'andromedatv')
  })
})
