import { AdminConfirmModal } from './admin-confirm-modal'
import { AdminMenuModal } from './admin-menu-modal'
import { AdminMessageActionsModal } from './admin-message-actions-modal'
import type {
  AdminAction,
  AdminMenuView,
  AdminUserLists,
  AdminUserLoading,
} from '../types/admin'

type AdminOverlaysProps = {
  adminConfirm: {
    active: boolean
    body: string
    tone: 'accent' | 'danger'
    title: string
    visible: boolean
  }
  adminMenu: {
    active: boolean
    userLists: AdminUserLists
    userLoading: AdminUserLoading
    userSearch: string
    view: AdminMenuView
    viewAnimating: boolean
    visible: boolean
  }
  adminMessageActions: {
    active: boolean
    target: {
      messageId: number
      nickname: string
    } | null
    visible: boolean
  }
  onCancelConfirm: () => void
  onCloseMenu: () => void
  onCloseMessageActions: () => void
  onConfirm: () => void
  onOpenClearChatConfirm: () => void
  onOpenUserView: (view: 'active' | 'banned') => void
  onSearchChange: (value: string) => void
  onSelectAction: (
    action: Extract<AdminAction, { kind: 'delete' | 'warn' | 'ban' }>,
  ) => void
  onUserAction: (action: AdminAction) => void
}

function AdminOverlays({
  adminConfirm,
  adminMenu,
  adminMessageActions,
  onCancelConfirm,
  onCloseMenu,
  onCloseMessageActions,
  onConfirm,
  onOpenClearChatConfirm,
  onOpenUserView,
  onSearchChange,
  onSelectAction,
  onUserAction,
}: AdminOverlaysProps) {
  return (
    <>
      <AdminMenuModal
        active={adminMenu.active}
        onClose={onCloseMenu}
        onOpenClearChatConfirm={onOpenClearChatConfirm}
        onOpenUserView={onOpenUserView}
        onSearchChange={onSearchChange}
        onUserAction={onUserAction}
        search={adminMenu.userSearch}
        userLists={adminMenu.userLists}
        userLoading={adminMenu.userLoading}
        view={adminMenu.view}
        viewAnimating={adminMenu.viewAnimating}
        visible={adminMenu.visible}
      />
      <AdminMessageActionsModal
        active={adminMessageActions.active}
        onClose={onCloseMessageActions}
        onSelectAction={onSelectAction}
        target={adminMessageActions.target}
        visible={adminMessageActions.visible}
      />
      <AdminConfirmModal
        active={adminConfirm.active}
        body={adminConfirm.body}
        onCancel={onCancelConfirm}
        onConfirm={onConfirm}
        tone={adminConfirm.tone}
        title={adminConfirm.title}
        visible={adminConfirm.visible}
      />
    </>
  )
}

export default AdminOverlays
