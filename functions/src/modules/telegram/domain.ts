import { TelegramContext, TelegramMessage, TelegramUpdate, TelegramUser } from "./types";

function getMessage(update: TelegramUpdate): TelegramMessage | null {
  if (update.message) return update.message;
  if (update.edited_message) return update.edited_message;
  if (update.callback_query?.message) return update.callback_query.message;
  return null;
}

function getUser(update: TelegramUpdate): TelegramUser | null {
  if (update.message?.from) return update.message.from;
  if (update.edited_message?.from) return update.edited_message.from;
  if (update.callback_query?.from) return update.callback_query.from;
  return null;
}

function getText(update: TelegramUpdate): string {
  const messageText = String(update.message?.text || update.edited_message?.text || "").trim();
  if (messageText) return messageText;

  const callbackData = String(update.callback_query?.data || "").trim();
  if (callbackData) return callbackData;

  return "";
}

export function normalizeTelegramCommand(text: string): string {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return "";

  const first = raw.split(/\s+/)[0] || "";
  const withoutMention = first.split("@")[0] || "";
  return withoutMention.toLowerCase();
}

export function buildTelegramContext(update: TelegramUpdate): TelegramContext | null {
  const message = getMessage(update);
  const user = getUser(update);
  const text = getText(update);

  const chatId = message?.chat?.id;
  const telegramUserId = user?.id;

  if (chatId === undefined || chatId === null || telegramUserId === undefined || telegramUserId === null) {
    return null;
  }

  return {
    updateId: String(update.update_id || ""),
    chatId: String(chatId),
    telegramUserId: String(telegramUserId),
    username: String(user?.username || "").trim(),
    firstName: String(user?.first_name || "").trim(),
    lastName: String(user?.last_name || "").trim(),
    text,
    command: normalizeTelegramCommand(text),
  };
}

export function buildTelegramDisplayName(ctx: TelegramContext): string {
  const fullName = `${ctx.firstName} ${ctx.lastName}`.trim();
  if (ctx.username) return `@${ctx.username}`;
  if (fullName) return fullName;
  return ctx.telegramUserId;
}