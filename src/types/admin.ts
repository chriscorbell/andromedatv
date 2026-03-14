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

export type AdminMenuView = 'main' | 'active' | 'banned'
export type AdminConfirmReturnView = AdminMenuView | 'message-actions' | null

export type AdminMessageActionTarget = {
  messageId: number
  nickname: string
}
