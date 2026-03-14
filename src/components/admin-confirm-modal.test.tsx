import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AdminConfirmModal } from './admin-confirm-modal'

describe('AdminConfirmModal', () => {
  it('exposes dialog semantics and traps focus while open', async () => {
    const user = userEvent.setup()
    const handleCancel = vi.fn()
    const handleConfirm = vi.fn()

    render(
      <AdminConfirmModal
        active
        body="the message will be replaced with message deleted."
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        title="delete this message?"
        visible
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'delete this message?' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')

    const cancelButton = screen.getByRole('button', { name: 'cancel' })
    const confirmButton = screen.getByRole('button', { name: 'confirm' })

    expect(cancelButton).toHaveFocus()

    await user.tab()
    expect(confirmButton).toHaveFocus()

    await user.tab()
    expect(cancelButton).toHaveFocus()
  })
})
