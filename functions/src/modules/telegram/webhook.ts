import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { createTelegramActionToken } from "./actionTokens";
import {
  buildBalanceResponse,
  buildCommandResponse,
  buildClientLinkResultResponse,
  buildClientTelegramStatusResponse,
  buildClientFacturaDeliveryMessage,
  buildCombinedTelegramStatusResponse,
  buildFacturaDirectMessage,
  buildLinkResultResponse,
  buildWebStatusResponse,
  isBalanceCommand,
  isWebCommand,
  isDocumentTestCommand,
  isFacturaTestCommand,
  isClientFacturaTestCommand,
  isPdfTestCommand,
} from "./commands";
import { buildTelegramContext } from "./domain";
import {
  consumeTelegramLinkToken,
  consumeClientTelegramLinkToken,
  getLatestFacturaDirectForTelegram,
  getLatestFacturaForClientTelegramDelivery,
  getClientTelegramRecipientsForClient,
  getLatestPdfUploadForTelegram,
  getLatestSolicitudDocumentForTelegram,
  getLinkedTelegramUser,
  getPublicAccessStatus,
  setPublicAccessStatusFromTelegram,
  getLinkedClientTelegramUser,
  getTelegramNotificationPrefsForUid,
  getUserBalanceForLinkedTelegramUser,
  markTelegramUpdateHandled,
  saveTelegramUpdate,
} from "./repository";
import {
  sendTelegramDocumentBuffer,
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  type TelegramInlineKeyboardButton,
} from "./service";
import { TelegramUpdate } from "./types";
import { recordOperationalMetric } from "../operationalMetrics/service";
if (!admin.apps.length) admin.initializeApp();

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_WEBHOOK_SECRET = defineSecret("TELEGRAM_WEBHOOK_SECRET");
const PAY0_WEB_CONTROL_CODE = defineSecret("PAY0_WEB_CONTROL_CODE");

function extractStartPayload(text: string): string {
  const clean = String(text || "").trim();
  const parts = clean.split(/\s+/);
  if ((parts[0] || "").split("@")[0].toLowerCase() !== "/start") return "";
  return String(parts[1] || "").trim();
}

function safeCaption(value: string): string {
  return String(value || "").slice(0, 1024);
}

async function sendUploadDocumentToTelegram(input: {
  botToken: string;
  chatId: string;
  storagePath: string;
  fileName: string;
  contentType: string;
  caption?: string;
}) {
  const bucket = admin.storage().bucket();
  const file = bucket.file(input.storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new Error("Archivo no encontrado en Storage.");
  }

  const [buffer] = await file.download();

  return await sendTelegramDocumentBuffer(
    input.botToken,
    input.chatId,
    input.fileName || "documento",
    buffer,
    input.contentType || "application/octet-stream",
    input.caption ? safeCaption(input.caption) : undefined
  );
}

export const telegramWebhook = onRequest(
  {
    region: "us-central1",
    cors: false,
    timeoutSeconds: 60,
    memory: "256MiB",
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PAY0_WEB_CONTROL_CODE],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("method not allowed");
      return;
    }

    const expectedSecret = String(TELEGRAM_WEBHOOK_SECRET.value() || "").trim();
    const receivedSecret = String(req.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();

    if (!expectedSecret) {
      logger.error("TELEGRAM_WEBHOOK_SECRET missing");
      res.status(500).send("secret missing");
      return;
    }

    if (receivedSecret !== expectedSecret) {
      logger.warn("Telegram webhook secret mismatch");
      res.status(401).send("unauthorized");
      return;
    }

    try {
      const update = (req.body || {}) as TelegramUpdate;

      const saved = await saveTelegramUpdate(update, {
        method: req.method,
        userAgent: String(req.get("user-agent") || ""),
        secretHeader: "ok",
      });

      const ctx = buildTelegramContext(update);

      if (!ctx) {
        await markTelegramUpdateHandled(saved.id, {
          handled: false,
          reason: "no_chat_context",
        });

        res.status(200).json({ ok: true, saved: true, handled: false });
        return;
      }

      let linkedUser = await getLinkedTelegramUser(ctx.telegramUserId);
      let linkedClient = await getLinkedClientTelegramUser(ctx.telegramUserId);
      let replyText = "";
      let inlineKeyboard: TelegramInlineKeyboardButton[][] | null = null;
      let handledByDirectSend = false;
      let directFilesSent = 0;

      const metricsRootId = String(linkedUser?.rootId || linkedClient?.rootId || "").trim();
      const metricsActorUid = String(linkedUser?.uid || "").trim() || null;
      const metricsClientId = String(linkedClient?.clientId || "").trim() || null;
      const metricsCorrelationId = `telegram:${ctx.updateId || ctx.telegramUserId}`;

      if (metricsRootId) {
        await recordOperationalMetric({
          rootId: metricsRootId,
          stage: "RECEIVED",
          channel: "TELEGRAM",
          caseType: "TELEGRAM_MESSAGE",
          correlationId: metricsCorrelationId,
          adminId: metricsActorUid,
          clientId: metricsClientId,
          actorUid: metricsActorUid,
          source: "AUTOMATION",
          outcome: ctx.command ? "COMMAND" : "MESSAGE",
        }).catch(() => undefined);
      }

      const startPayload = ctx.command === "/start" ? extractStartPayload(ctx.text) : "";

      if (startPayload) {
        const clientLinkResult = await consumeClientTelegramLinkToken(startPayload, ctx);

        if (clientLinkResult.ok || clientLinkResult.reason !== "token_not_found") {
          linkedClient = clientLinkResult.linkedClient || linkedClient;
          replyText = buildClientLinkResultResponse(
            clientLinkResult.ok,
            clientLinkResult.reason,
            clientLinkResult.linkedClient?.clientName
          );
        } else if (!linkedUser?.uid) {
          const linkResult = await consumeTelegramLinkToken(startPayload, ctx);
          linkedUser = linkResult.linkedUser || linkedUser;
          replyText = buildLinkResultResponse(linkResult.ok, linkResult.reason, linkResult.linkedUser);
        } else {
          replyText = buildCommandResponse(ctx, linkedUser);
        }
      } else if (isBalanceCommand(ctx.command)) {
        const balance = linkedUser?.uid
          ? await getUserBalanceForLinkedTelegramUser(linkedUser)
          : null;

        replyText = buildBalanceResponse(linkedUser, balance);      } else if (isWebCommand(ctx.command) || ctx.command === "/huevon" || ctx.command === "/huevoff") {
        const parts = String(ctx.text || "").trim().split(/\s+/);
        const directAction =
          ctx.command === "/huevon" ? "on" :
          ctx.command === "/huevoff" ? "off" :
          "";
        const action = directAction || String(parts[1] || "").trim().toLowerCase();

        if (!linkedUser?.uid) {
          replyText = [
            "Cuenta PAY0: no vinculada.",
            "Genera un enlace desde PAY0 web para usar este comando.",
          ].join("\n");
        } else {
          const role = String(linkedUser.role || "").trim().toLowerCase();

          if (role !== "superadmin") {
            replyText = "Solo superadmin puede usar comandos web.";
          } else if (ctx.command === "/web" && action === "status") {
            const status = await getPublicAccessStatus();
            replyText = buildWebStatusResponse({
              linkedUser,
              enabled: status.enabled,
              reason: status.reason,
              updatedAtText: status.updatedAtText,
            });
          } else if (ctx.command === "/web" && (action === "on" || action === "off")) {
            replyText = [
              "Comando web no disponible.",
              "Usa el canal operativo autorizado.",
            ].join("\n");
          } else if (directAction === "on" || directAction === "off") {
            const code = String(parts[1] || "").trim();
            const expectedCode = String(PAY0_WEB_CONTROL_CODE.value() || "").trim();

            if (!expectedCode) {
              replyText = "Codigo web no configurado en servidor.";
            } else if (!code || code !== expectedCode) {
              replyText = "Codigo invalido. Operacion rechazada.";
            } else {
              const enabled = directAction === "on";
              const result = await setPublicAccessStatusFromTelegram({
                linkedUser,
                enabled,
                reason: enabled ? "Sistema activo" : "Sistema en mantenimiento",
              });

              replyText = [
                enabled ? "Web activada." : "Modo mantenimiento activado.",
                "",
                `Estado: ${result.enabled ? "ACTIVA" : "MANTENIMIENTO"}`,
                `Motivo: ${result.reason}`,
                "",
                "Accion registrada en Activity Log.",
              ].join("\n");
            }
          } else {
            replyText = [
              "Comando web no disponible.",
              "Usa: /web status",
            ].join("\n");
          }
        }
      } else if (isClientFacturaTestCommand(ctx.command)) {
        if (!linkedUser?.uid) {
          replyText = [
            "Cuenta PAY0: no vinculada.",
            "Solo un usuario PAY0 puede ejecutar esta prueba.",
          ].join("\n");
        } else {
          const rootId = String(linkedUser.rootId || linkedUser.uid);
          const factura = await getLatestFacturaForClientTelegramDelivery(rootId);

          if (!factura) {
            replyText = [
              "No encontre factura PDF/XML activa para enviar al cliente.",
              "Debe existir una solicitud con FACTURA_PDF y FACTURA_XML activos.",
            ].join("\n");
          } else {
            const recipients = await getClientTelegramRecipientsForClient(factura.clientId);

            if (recipients.length === 0) {
              replyText = [
                "El cliente no tiene Telegram vinculado.",
                `Cliente: ${factura.clientName}`,
                `Solicitud: ${factura.solicitudFolio}`,
              ].join("\n");
            } else {
              const message = buildClientFacturaDeliveryMessage({
                clientName: factura.clientName,
                companyName: factura.companyName,
                totalAmount: factura.totalAmount,
                solicitudFolio: factura.solicitudFolio,
              });

              let sent = 0;

              for (const recipient of recipients) {
                await sendTelegramMessage(
                  TELEGRAM_BOT_TOKEN.value(),
                  recipient.chatId,
                  message
                );

                await sendUploadDocumentToTelegram({
                  botToken: TELEGRAM_BOT_TOKEN.value(),
                  chatId: recipient.chatId,
                  storagePath: factura.pdf.storagePath,
                  fileName: factura.pdf.fileName || "factura.pdf",
                  contentType: factura.pdf.contentType || "application/pdf",
                  caption: "PDF",
                });

                await sendUploadDocumentToTelegram({
                  botToken: TELEGRAM_BOT_TOKEN.value(),
                  chatId: recipient.chatId,
                  storagePath: factura.xml.storagePath,
                  fileName: factura.xml.fileName || "factura.xml",
                  contentType: factura.xml.contentType || "application/xml",
                  caption: "XML",
                });

                sent += 1;
              }

              replyText = [
                "Factura enviada al Telegram del cliente.",
                `Cliente: ${factura.clientName}`,
                `Solicitud: ${factura.solicitudFolio}`,
                `Destinatarios: ${sent}`,
              ].join("\n");
            }
          }
        }
      } else if (isFacturaTestCommand(ctx.command)) {
        if (!linkedUser?.uid) {
          replyText = [
            "Cuenta PAY0: no vinculada.",
            "Genera un enlace desde PAY0 web para usar /facturaprueba.",
          ].join("\n");
        } else {
          const prefs = await getTelegramNotificationPrefsForUid(linkedUser.uid);

          if (!prefs.enabled) {
            replyText = "Notificaciones Telegram pausadas. Activalas desde PAY0 web.";
          } else {
            const rootId = String(linkedUser.rootId || linkedUser.uid);
            const factura = await getLatestFacturaDirectForTelegram(rootId);

            if (!factura || (!factura.pdf && !factura.xml)) {
              replyText = [
                "No encontre factura PDF/XML activa para tu scope.",
                "Sube o finaliza una factura PDF/XML y vuelve a intentar /facturaprueba.",
              ].join("\n");
            } else {
              const message = buildFacturaDirectMessage({
                clientName: factura.clientName,
                companyName: factura.companyName,
                totalAmount: factura.totalAmount,
                solicitudFolio: factura.solicitudFolio,
                hasPdf: Boolean(factura.pdf),
                hasXml: Boolean(factura.xml),
              });

              await sendTelegramMessage(
                TELEGRAM_BOT_TOKEN.value(),
                ctx.chatId,
                message
              );

              if (factura.pdf) {
                await sendUploadDocumentToTelegram({
                  botToken: TELEGRAM_BOT_TOKEN.value(),
                  chatId: ctx.chatId,
                  storagePath: factura.pdf.storagePath,
                  fileName: factura.pdf.fileName || "factura.pdf",
                  contentType: factura.pdf.contentType || "application/pdf",
                  caption: "PDF",
                });
                directFilesSent += 1;
              }

              if (factura.xml) {
                await sendUploadDocumentToTelegram({
                  botToken: TELEGRAM_BOT_TOKEN.value(),
                  chatId: ctx.chatId,
                  storagePath: factura.xml.storagePath,
                  fileName: factura.xml.fileName || "factura.xml",
                  contentType: factura.xml.contentType || "application/xml",
                  caption: "XML",
                });
                directFilesSent += 1;
              }

              handledByDirectSend = true;
            }
          }
        }
      } else if (isPdfTestCommand(ctx.command)) {
        if (!linkedUser?.uid) {
          replyText = [
            "Cuenta PAY0: no vinculada.",
            "Genera un enlace desde PAY0 web para usar /pdfprueba.",
          ].join("\n");
        } else {
          const prefs = await getTelegramNotificationPrefsForUid(linkedUser.uid);

          if (!prefs.enabled) {
            replyText = "Notificaciones Telegram pausadas. Activalas desde PAY0 web.";
          } else {
            const rootId = String(linkedUser.rootId || linkedUser.uid);
            const pdf = await getLatestPdfUploadForTelegram(rootId);

            if (!pdf) {
              replyText = [
                "No encontre PDF activo para tu scope.",
                "Sube o finaliza un PDF y vuelve a intentar /pdfprueba.",
              ].join("\n");
            } else {
              await sendUploadDocumentToTelegram({
                botToken: TELEGRAM_BOT_TOKEN.value(),
                chatId: ctx.chatId,
                storagePath: pdf.storagePath,
                fileName: pdf.fileName || "documento.pdf",
                contentType: pdf.contentType || "application/pdf",
                caption: [
                  "PAY0 PDF de prueba",
                  "",
                  `Solicitud: ${pdf.solicitudFolio || pdf.solicitudId || "N/D"}`,
                  `Tipo: ${pdf.documentType || "PDF"}`,
                  "",
                  "Archivo enviado directo por Telegram.",
                ].join("\n"),
              });

              handledByDirectSend = true;
              directFilesSent = 1;
            }
          }
        }
      } else if (isDocumentTestCommand(ctx.command)) {
        if (!linkedUser?.uid) {
          replyText = [
            "Cuenta PAY0: no vinculada.",
            "Genera un enlace desde PAY0 web para usar /docprueba.",
          ].join("\n");
        } else {
          const prefs = await getTelegramNotificationPrefsForUid(linkedUser.uid);

          if (!prefs.enabled) {
            replyText = "Notificaciones Telegram pausadas. Activalas desde PAY0 web.";
          } else {
            const rootId = String(linkedUser.rootId || linkedUser.uid);
            const doc = await getLatestSolicitudDocumentForTelegram(rootId);

            if (!doc) {
              replyText = [
                "No encontre documentos reales de solicitud para tu scope.",
                "Sube o finaliza un documento y vuelve a intentar /docprueba.",
              ].join("\n");
            } else {
              const action = await createTelegramActionToken({
                actionType: "DOWNLOAD_DOCUMENT",
                uid: linkedUser.uid,
                rootId,
                entityType: "solicitud",
                entityId: doc.solicitudId || doc.id,
                documentId: doc.id,
                storagePath: doc.storagePath,
                fileName: doc.fileName,
                expiresInMinutes: 15,
              });

              replyText = [
                "PAY0 documento disponible",
                "",
                `Tipo: ${doc.type || "DOCUMENTO"}`,
                `Archivo: ${doc.fileName || "documento"}`,
                `Solicitud: ${doc.solicitudId || "N/D"}`,
                "",
                "El boton genera una descarga temporal.",
                "El enlace expira en 15 minutos.",
              ].join("\n");

              inlineKeyboard = [
                [
                  {
                    text: "Descargar documento",
                    url: action.url,
                  },
                ],
              ];
            }
          }
        }
      } else if (ctx.command === "/status" && linkedClient?.clientId) {
        if (linkedUser?.uid) {
          replyText = buildCombinedTelegramStatusResponse({
            role: String(linkedUser.role || "N/D"),
            clientName: String(linkedClient.clientName || "N/D"),
            telegramUsername: String(linkedClient.telegramUsername || ""),
          });
        } else {
          replyText = buildClientTelegramStatusResponse({
            clientName: String(linkedClient.clientName || "N/D"),
            telegramUsername: String(linkedClient.telegramUsername || ""),
          });
        }
      } else {
        replyText = buildCommandResponse(ctx, linkedUser);
      }

      try {
        let sendResult: any = { ok: true, directFilesSent };

        if (!handledByDirectSend) {
          sendResult = inlineKeyboard
            ? await sendTelegramMessageWithKeyboard(
                TELEGRAM_BOT_TOKEN.value(),
                ctx.chatId,
                replyText,
                inlineKeyboard
              )
            : await sendTelegramMessage(
                TELEGRAM_BOT_TOKEN.value(),
                ctx.chatId,
                replyText
              );
        }

        await markTelegramUpdateHandled(saved.id, {
          handled: true,
          command: ctx.command || "",
          chatId: ctx.chatId,
          telegramUserId: ctx.telegramUserId,
          linked: Boolean(linkedUser?.uid),
          startPayload: Boolean(startPayload),
          hasInlineKeyboard: Boolean(inlineKeyboard),
          directFilesSent,
          sendOk: Boolean(sendResult?.ok),
        });

        if (metricsRootId && Boolean(sendResult?.ok)) {
          await recordOperationalMetric({
            rootId: metricsRootId,
            stage: "FIRST_RESPONSE",
            channel: "TELEGRAM",
            caseType: "TELEGRAM_MESSAGE",
            correlationId: metricsCorrelationId,
            adminId: metricsActorUid,
            clientId: metricsClientId,
            actorUid: metricsActorUid,
            source: "AUTOMATION",
            outcome: "RESPONDED",
          }).catch(() => undefined);
        }
      } catch (sendError: any) {
        logger.error("Telegram send error", sendError);

        await markTelegramUpdateHandled(saved.id, {
          handled: true,
          command: ctx.command || "",
          chatId: ctx.chatId,
          telegramUserId: ctx.telegramUserId,
          linked: Boolean(linkedUser?.uid),
          startPayload: Boolean(startPayload),
          hasInlineKeyboard: Boolean(inlineKeyboard),
          directFilesSent,
          sendOk: false,
          sendError: String(sendError?.message || sendError || "unknown"),
        });
      }

      res.status(200).json({ ok: true });
    } catch (error: any) {
      logger.error("Telegram webhook error", error);
      res.status(200).json({
        ok: false,
        error: "telegram_webhook_error",
      });
    }
  }
);
