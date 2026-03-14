import { AdminConfirmModal } from './admin-confirm-modal'
import { AdminMenuModal } from './admin-menu-modal'
import { AdminMessageActionsModal } from './admin-message-actions-modal'
import type { AdminAction, AdminMenuView, AdminUser } from '../types/admin'

type AdminOverlaysProps = {
  adminConfirm: {
    active: boolean
    body: string
    title: string
    visible: boolean
  }
  adminMenu: {
    active: boolean
    userList: AdminUser[]
    userLoading: boolean
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
  onBack: () => void
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
  onBack,
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
        onBack={onBack}
        onClose={onCloseMenu}
        onOpenClearChatConfirm={onOpenClearChatConfirm}
        onOpenUserView={onOpenUserView}
        onSearchChange={onSearchChange}
        onUserAction={onUserAction}
        search={adminMenu.userSearch}
        userList={adminMenu.userList}
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
        title={adminConfirm.title}
        visible={adminConfirm.visible}
      />
    </>
  )
}

export default AdminOverlays
