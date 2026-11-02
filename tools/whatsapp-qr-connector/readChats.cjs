"use strict";
// Recovered tolerant chat reader; no Admin SDK, writes, startup or message sending.
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
module.exports = async function readChats(client) {
  let chats;

  try {
    chats = await client.getChats();
  } catch (error) {
    if (/Target closed|Session closed|browser has disconnected/i.test(String(error?.message || error))) throw error;

    console.warn(
      "[PAY0 WA] getChats fallo; usando lectura tolerante:",
      error && (error.message || error)
    );

    if (!client.pupPage || client.pupPage.isClosed()) {
      throw new Error("No hay pagina activa de WhatsApp para sincronizar chats.");
    }

    const fallback = await client.pupPage.evaluate(() => {
      const widToString = (value) => {
        if (!value) return "";
        if (typeof value === "string") return value;

        if (typeof value._serialized === "string" && value._serialized) {
          return value._serialized;
        }

        if (typeof value.$1 === "string" && value.$1) {
          return value.$1;
        }

        const user = value.user;
        const server = value.server;

        if (user && server) {
          return `${user}@${server}`;
        }

        try {
          const rendered =
            typeof value.toString === "function" ? value.toString() : "";

          if (rendered && rendered !== "[object Object]") {
            return rendered;
          }
        } catch (_) {
          // Ignorar WID no serializable.
        }

        return "";
      };

      let collections;

      try {
        collections = window.require("WAWebCollections");
      } catch (_) {
        return {
          items: [],
          total: 0,
          skipped: 0,
          error: "WAWebCollections no disponible.",
        };
      }

      const collection = collections && collections.Chat;

      if (!collection || typeof collection.getModelsArray !== "function") {
        return {
          items: [],
          total: 0,
          skipped: 0,
          error: "WAWebCollections.Chat no disponible.",
        };
      }

      const models = collection.getModelsArray();
      const items = [];
      let skipped = 0;

      for (const chat of models) {
        try {
          const serialized =
            chat && typeof chat.serialize === "function"
              ? chat.serialize()
              : {};

          const chatId = widToString(
            (serialized && serialized.id) || (chat && chat.id)
          );

          if (!chatId) {
            skipped++;
            continue;
          }

          items.push({
            id: {
              _serialized: chatId,
            },
            name:
              (serialized && serialized.name) ||
              (serialized && serialized.formattedTitle) ||
              (chat && chat.name) ||
              (chat && chat.formattedTitle) ||
              chatId,
            formattedTitle:
              (serialized && serialized.formattedTitle) ||
              (chat && chat.formattedTitle) ||
              "",
            isGroup: Boolean(
              (serialized && serialized.isGroup) ||
              (chat && chat.isGroup) ||
              (chat && chat.groupMetadata) ||
              chatId.endsWith("@g.us")
            ),
            archived: Boolean(
              (serialized && serialized.archived) ??
              (chat && chat.archived) ??
              (chat && chat.archive) ??
              false
            ),
            pinned: Boolean(
              (serialized && serialized.pinned) ??
              (chat && chat.pinned) ??
              (chat && chat.pin) ??
              false
            ),
            timestamp:
              (serialized && serialized.timestamp) ??
              (chat && chat.timestamp) ??
              (chat && chat.t) ??
              null,
          });
        } catch (_) {
          skipped++;
        }
      }

      return {
        items,
        total: models.length,
        skipped,
        error: null,
      };
    });

    if (fallback && fallback.error) {
      throw new Error(fallback.error);
    }

    chats =
      fallback && Array.isArray(fallback.items)
        ? fallback.items
        : [];

    const total = Number((fallback && fallback.total) || 0);
    const skipped = Number((fallback && fallback.skipped) || 0);

    if (total > 0 && chats.length === 0) {
      throw new Error(
        "La lectura tolerante encontro chats pero no pudo serializar ninguno."
      );
    }

    console.log(
      `[PAY0 WA] Fallback chats: ${chats.length}/${total}; omitidos: ${skipped}`
    );
  }
  return chats;
};
