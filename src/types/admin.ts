export type AdminAction =
  | { kind: 'clear' }
  | { kind: 'delete'; messageId: number }
  | { kind: 'warn'; messageId: number }
  | { kind: 'ban'; nickname: string }
  | { kind: 'unban'; nickname: string }
  | { kind: 'delete-user'; nickname: string }

export type AdminUser = {
  nickname: string
  created_at: string
}

export type AdminMenuView = 'active' | 'banned'
export type AdminUserLists = Record<AdminMenuView, AdminUser[]>
export type AdminUserLoading = Record<AdminMenuView, boolean>
export type AdminConfirmReturnView = AdminMenuView | 'message-actions' | null

export type AdminMessageActionTarget = {
  messageId: number
  nickname: string
}
