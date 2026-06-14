import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AdminMenuModal } from './admin-menu-modal'

const activeUsers = [
  { nickname: 'nova_kade', created_at: '2026-06-03T12:00:00.000Z' },
  { nickname: 'pixelwitch', created_at: '2026-05-28T12:00:00.000Z' },
]

const bannedUsers = [
  { nickname: 'drift_07', created_at: '2026-05-21T12:00:00.000Z' },
]

describe('AdminMenuModal', () => {
  it('renders user counts and wires active-user controls', () => {
    const onOpenUserView = vi.fn()
    const onOpenClearChatConfirm = vi.fn()
    const onSearchChange = vi.fn()
    const onUserAction = vi.fn()

    render(
      <AdminMenuModal
        active
        onClose={vi.fn()}
        onOpenClearChatConfirm={onOpenClearChatConfirm}
        onOpenUserView={onOpenUserView}
        onSearchChange={onSearchChange}
        onUserAction={onUserAction}
        search=""
        userLists={{ active: activeUsers, banned: bannedUsers }}
        userLoading={{ active: false, banned: false }}
        view="active"
        viewAnimating={false}
        visible
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Admin' })).toBeVisible()
    expect(screen.getByRole('tab', { name: /Active\s*2/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: /Banned\s*1/ })).toBeVisible()
    expect(screen.getByText('Joined Jun 3, 2026')).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: /Banned\s*1/ }))
    expect(onOpenUserView).toHaveBeenCalledWith('banned')

    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'nova' },
    })
    expect(onSearchChange).toHaveBeenCalledWith('nova')

    fireEvent.click(screen.getByRole('button', { name: 'Ban nova_kade' }))
    expect(onUserAction).toHaveBeenCalledWith({
      kind: 'ban',
      nickname: 'nova_kade',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete nova_kade' }))
    expect(onUserAction).toHaveBeenCalledWith({
      kind: 'delete-user',
      nickname: 'nova_kade',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onOpenClearChatConfirm).toHaveBeenCalledTimes(1)
  })

  it('offers unban controls in the banned view', () => {
    const onUserAction = vi.fn()

    render(
      <AdminMenuModal
        active
        onClose={vi.fn()}
        onOpenClearChatConfirm={vi.fn()}
        onOpenUserView={vi.fn()}
        onSearchChange={vi.fn()}
        onUserAction={onUserAction}
        search=""
        userLists={{ active: activeUsers, banned: bannedUsers }}
        userLoading={{ active: false, banned: false }}
        view="banned"
        viewAnimating={false}
        visible
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Unban drift_07' }))
    expect(onUserAction).toHaveBeenCalledWith({
      kind: 'unban',
      nickname: 'drift_07',
    })
  })
})
