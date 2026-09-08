export type TelegramUser = {
  id?: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TelegramChat = {
  id?: number | string;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramMessage = {
  message_id?: number;
  from?: TelegramUser;
  chat?: TelegramChat;
  date?: number;
  text?: string;
};

export type TelegramCallbackQuery = {
  id?: string;
  from?: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

export type TelegramContext = {
  updateId: string;
  chatId: string;
  telegramUserId: string;
  username: string;
  firstName: string;
  lastName: string;
  text: string;
  command: string;
};

export type LinkedTelegramUser = {
  uid?: string;
  rootId?: string;
  role?: string;
  active?: boolean;
  username?: string;
  displayName?: string;
  telegramUsername?: string;
  telegramUserId?: string;
  chatId?: string;
};

export type TelegramLinkToken = {
  token?: string;
  uid?: string;
  rootId?: string;
  role?: string;
  username?: string;
  displayName?: string;
  status?: "PENDING" | "LINKED" | "EXPIRED" | "CANCELLED";
  expiresAt?: any;
  createdAt?: any;
  linkedAt?: any;
  telegramUserId?: string;
  chatId?: string;
  telegramUsername?: string;
};

export type TelegramBalanceSummary = {
  found: boolean;
  holderType: "USER";
  holderId: string;
  holderName: string;
  availableBalance: number;
  totalGenerated: number;
  totalSpent: number;
  totalAdjusted: number;
  totalReturned: number;
};
export type TelegramNotificationPrefs = {
  uid: string;
  enabled: boolean;
  notifySaldo: boolean;
  notifyPagos: boolean;
  notifySolicitudes: boolean;
  notifyDispersiones: boolean;
  createdAt?: any;
  updatedAt?: any;
};
export type LinkedClientTelegramUser = {
  clientId?: string;
  rootId?: string;
  clientName?: string;
  active?: boolean;
  telegramUsername?: string;
  telegramUserId?: string;
  chatId?: string;
};

export type ClientTelegramLinkToken = {
  token?: string;
  clientId?: string;
  rootId?: string;
  clientName?: string;
  status?: "PENDING" | "LINKED" | "EXPIRED" | "CANCELLED";
  expiresAt?: any;
  createdAt?: any;
  linkedAt?: any;
  createdByUid?: string;
  telegramUserId?: string;
  telegramUsername?: string;
};
