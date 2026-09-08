import { buildTelegramDisplayName } from "./domain";
import { LinkedTelegramUser, TelegramBalanceSummary, TelegramContext } from "./types";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function isBalanceCommand(command: string): boolean {
  return command === "/saldo" || command === "/saldos";
}

export function isWebCommand(command: string): boolean {
  return command === "/web";
}

export function isDocumentTestCommand(command: string): boolean {
  return command === "/docprueba";
}

export function isPdfTestCommand(command: string): boolean {
  return command === "/pdfprueba";
}

export function isFacturaTestCommand(command: string): boolean {
  return command === "/facturaprueba";
}

export function isClientFacturaTestCommand(command: string): boolean {
  return command === "/facturaclienteprueba";
}

export function buildWebStatusResponse(input: {
  linkedUser: LinkedTelegramUser | null;
  enabled: boolean;
  reason: string;
  updatedAtText: string;
}): string {
  if (!input.linkedUser?.uid) {
    return [
      "Cuenta PAY0: no vinculada.",
      "Genera un enlace desde PAY0 web para usar /web status.",
    ].join("\n");
  }

  const role = String(input.linkedUser.role || "").trim().toLowerCase();
  if (role !== "superadmin") {
    return "Solo superadmin puede consultar el estado web.";
  }

  return [
    "PAY0 web status",
    "",
    `Estado: ${input.enabled ? "ACTIVA" : "MANTENIMIENTO"}`,
    `Motivo: ${input.reason || "N/D"}`,
    `Actualizado: ${input.updatedAtText || "N/D"}`,
    "",
    "Comando read-only. No cambia el sistema.",
  ].join("\n");
}
export function buildBalanceResponse(
  linkedUser: LinkedTelegramUser | null,
  balance: TelegramBalanceSummary | null
): string {
  if (!linkedUser?.uid) {
    return [
      "Cuenta PAY0: no vinculada.",
      "Genera un enlace desde PAY0 web para usar /saldo.",
    ].join("\n");
  }

  if (!balance) {
    return "No se pudo consultar el saldo.";
  }

  return [
    "PAY0 saldo usuario",
    "",
    `Usuario: ${String(linkedUser.username || linkedUser.displayName || "N/D")}`,
    `Rol: ${String(linkedUser.role || "N/D")}`,
    "",
    `Saldo disponible: ${formatMoney(balance.availableBalance)}`,
    `Total generado: ${formatMoney(balance.totalGenerated)}`,
    `Total gastado: ${formatMoney(balance.totalSpent)}`,
    `Ajustes: ${formatMoney(balance.totalAdjusted)}`,
    "",
    "Consulta read-only. No ejecuta movimientos.",
  ].join("\n");
}

export function buildFacturaDirectMessage(input: {
  clientName: string;
  companyName: string;
  totalAmount: number;
  solicitudFolio: string;
  hasPdf: boolean;
  hasXml: boolean;
}): string {
  const formats: string[] = [];

  if (input.hasPdf) formats.push("PDF");
  if (input.hasXml) formats.push("XML");

  const formatText =
    formats.length > 1
      ? `${formats.join(" y ")} listos.`
      : formats.length === 1
      ? `${formats[0]} listo.`
      : "Documento listo.";

  return [
    "PAY0 factura disponible",
    "",
    `Factura disponible de ${input.clientName} con ${input.companyName} por un total de ${formatMoney(input.totalAmount)}.`,
    `Solicitud: ${input.solicitudFolio}`,
    "",
    formatText,
    "Archivos enviados directo por Telegram.",
  ].join("\n");
}

export function buildCommandResponse(
  ctx: TelegramContext,
  linkedUser: LinkedTelegramUser | null
): string {
  const displayName = buildTelegramDisplayName(ctx);

  if (ctx.command === "/start") {
    if (linkedUser?.uid) {
      return [
        "PAY0 bot activo.",
        "",
        `Usuario Telegram: ${displayName}`,
        "Cuenta PAY0: vinculada",
        `Rol: ${String(linkedUser.role || "N/D")}`,
        "Modo T1: vinculacion segura activa.",
      ].join("\n");
    }

    return [
      "PAY0 bot activo.",
      "",
      `Usuario Telegram: ${displayName}`,
      "Cuenta PAY0: no vinculada",
      "Para vincular, genera un enlace desde PAY0 web.",
    ].join("\n");
  }

  if (ctx.command === "/help") {
    return [
      "PAY0 bot - ayuda",
      "",
      "Comandos disponibles:",
      "/start - iniciar bot o vincular con token",
      "/help - ver ayuda",
      "/status - ver estado de vinculacion",
      "/saldo - ver saldo usuario PAY0",
      "/web status - ver estado web",
      "/docprueba - probar descarga temporal de documento",
      "/pdfprueba - probar envio directo de PDF",
      "/facturaprueba - probar factura directa PDF/XML",
      "/facturaclienteprueba - probar envio al cliente",
      "",
      "Modo T3: read-only. Sin acciones operativas.",
    ].join("\n");
  }

  if (ctx.command === "/status") {
    if (linkedUser?.uid) {
      return [
        "PAY0 bot status",
        "",
        "Webhook: activo",
        "Cuenta PAY0: vinculada",
        `Rol: ${String(linkedUser.role || "N/D")}`,
        "Acciones operativas: desactivadas",
      ].join("\n");
    }

    return [
      "PAY0 bot status",
      "",
      "Webhook: activo",
      "Cuenta PAY0: no vinculada",
      "Acciones operativas: desactivadas",
    ].join("\n");
  }

  if (isBalanceCommand(ctx.command)) {
    return buildBalanceResponse(linkedUser, null);
  }

  if (isDocumentTestCommand(ctx.command)) {
    return "Preparando documento de prueba...";
  }

  if (isPdfTestCommand(ctx.command)) {
    return "Preparando PDF de prueba...";
  }

  if (isFacturaTestCommand(ctx.command)) {
    return "Preparando factura de prueba...";
  }

  if (isClientFacturaTestCommand(ctx.command)) {
    return "Preparando factura para cliente...";
  }

  return [
    "Comando no disponible.",
    "Usa /help para ver comandos activos.",
  ].join("\n");
}

export function buildLinkResultResponse(
  ok: boolean,
  reason: string | undefined,
  linkedUser: LinkedTelegramUser | undefined
): string {
  if (ok) {
    return [
      "Cuenta Telegram vinculada correctamente.",
      "",
      `Rol PAY0: ${String(linkedUser?.role || "N/D")}`,
      "Acciones operativas: desactivadas por seguridad.",
      "Usa /status para verificar.",
    ].join("\n");
  }

  if (reason === "token_expired") {
    return "El enlace de vinculacion expiro. Genera uno nuevo desde PAY0 web.";
  }

  if (reason === "token_not_pending") {
    return "El enlace de vinculacion ya fue usado o ya no esta disponible.";
  }

  if (reason === "token_not_found") {
    return "El enlace de vinculacion no es valido.";
  }

  return "No se pudo vincular la cuenta. Genera un nuevo enlace desde PAY0 web.";
}
export function buildClientTelegramStatusResponse(input: {
  clientName: string;
  telegramUsername: string;
}): string {
  const tg = input.telegramUsername ? `@${input.telegramUsername.replace(/^@/, "")}` : "N/D";

  return [
    "PAY0 bot status",
    "",
    "Cliente PAY0: vinculado",
    `Cliente: ${input.clientName || "N/D"}`,
    `Usuario Telegram: ${tg}`,
    "",
    "Este canal recibira documentos del cliente cuando esten disponibles.",
  ].join("\n");
}

export function buildClientLinkResultResponse(
  ok: boolean,
  reason: string | undefined,
  clientName: string | undefined
): string {
  if (ok) {
    return [
      "Cliente PAY0 vinculado correctamente.",
      "",
      `Cliente: ${clientName || "N/D"}`,
      "Este canal recibira documentos del cliente cuando esten disponibles.",
    ].join("\n");
  }

  if (reason === "token_expired") {
    return "El enlace de vinculacion del cliente expiro. Solicita uno nuevo.";
  }

  if (reason === "token_not_pending") {
    return "El enlace de vinculacion del cliente ya fue usado o ya no esta disponible.";
  }

  if (reason === "token_not_found") {
    return "El enlace de vinculacion del cliente no es valido.";
  }

  return "No se pudo vincular el cliente. Solicita un nuevo enlace.";
}
export function buildCombinedTelegramStatusResponse(input: {
  role: string;
  clientName: string;
  telegramUsername: string;
}): string {
  const tg = input.telegramUsername ? `@${input.telegramUsername.replace(/^@/, "")}` : "N/D";

  return [
    "PAY0 bot status",
    "",
    "Webhook: activo",
    "Cuenta PAY0: vinculada",
    `Rol: ${input.role || "N/D"}`,
    "",
    "Cliente PAY0: vinculado",
    `Cliente: ${input.clientName || "N/D"}`,
    `Usuario Telegram: ${tg}`,
    "",
    "Acciones operativas: desactivadas",
  ].join("\n");
}
export function buildClientFacturaDeliveryMessage(input: {
  clientName: string;
  companyName: string;
  totalAmount: number;
  solicitudFolio: string;
}): string {
  return [
    "PAY0 factura disponible",
    "",
    `Factura disponible de ${input.clientName} con ${input.companyName} por un total de ${formatMoney(input.totalAmount)}.`,
    `Solicitud: ${input.solicitudFolio}`,
    "",
    "PDF y XML listos.",
    "Archivos enviados directo por Telegram.",
  ].join("\n");
}
