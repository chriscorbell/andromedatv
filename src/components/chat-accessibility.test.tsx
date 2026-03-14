import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatAuthForm } from './chat-auth-form'
import { ChatComposer } from './chat-composer'

describe('chat accessibility', () => {
  it('connects auth form labels and error/status messaging', () => {
    render(
      <ChatAuthForm
        authError="Invalid credentials"
        authLoading={false}
        authMode="login"
        chatError="Chat unavailable"
        chatLoading
        nickname="testuser"
        onAuthModeToggle={vi.fn()}
        onNicknameChange={vi.fn()}
        onPasswordChange={vi.fn()}
        onSubmit={vi.fn()}
        password="hunter2"
      />,
    )

    const usernameInput = screen.getByLabelText('Username')
    const passwordInput = screen.getByLabelText('Password')

    expect(usernameInput).toHaveAttribute('aria-invalid', 'true')
    expect(passwordInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid credentials')
    expect(screen.getAllByRole('status')).toHaveLength(2)
  })

  it('wires composer labels, alerts, and admin affordances', () => {
    const handleMessageBodyChange = vi.fn()
    const handleOpenAdminMenu = vi.fn()
    const handleSignOut = vi.fn()
    const textareaRef = { current: null }

    render(
      <ChatComposer
        authIsAdmin
        chatError="slow down"
        chatLoading
        chatNotice="you have been warned"
        cooldownRemaining={12}
        disabled={false}
        messageBody="hello"
        onMessageBodyChange={handleMessageBodyChange}
        onOpenAdminMenu={handleOpenAdminMenu}
        onSignOut={handleSignOut}
        onSubmit={vi.fn()}
        textareaRef={textareaRef}
      />,
    )

    const textarea = screen.getByLabelText('Chat message')
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('slow down')
    expect(screen.getAllByRole('status')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Open admin menu' }))
    expect(handleOpenAdminMenu).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'sign out' }))
    expect(handleSignOut).toHaveBeenCalledTimes(1)
  })
})
