import * as https from "https";

function postJson(url: string, body: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed: any = raw;

          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch {
            parsed = { raw };
          }

          const statusCode = Number(res.statusCode || 0);
          if (statusCode >= 200 && statusCode < 300) {
            resolve(parsed);
            return;
          }

          reject(new Error(`Telegram API error ${statusCode}: ${raw}`));
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<any> {
  const token = String(botToken || "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN no configurado.");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  return await postJson(url, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}
export type TelegramInlineKeyboardButton = {
  text: string;
  url?: string;
  callback_data?: string;
};

export async function sendTelegramMessageWithKeyboard(
  botToken: string,
  chatId: string,
  text: string,
  inlineKeyboard: TelegramInlineKeyboardButton[][]
): Promise<any> {
  const token = String(botToken || "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN no configurado.");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  return await postJson(url, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: inlineKeyboard,
    },
  });
}
function multipartEscape(value: string): string {
  return String(value || "").replace(/"/g, "");
}

export async function sendTelegramDocumentBuffer(
  botToken: string,
  chatId: string,
  fileName: string,
  buffer: Buffer,
  contentType: string,
  caption?: string
): Promise<any> {
  const token = String(botToken || "").trim();

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN no configurado.");
  }

  if (!chatId) {
    throw new Error("chatId requerido.");
  }

  if (!buffer || buffer.length <= 0) {
    throw new Error("Archivo vacio.");
  }

  const boundary = `----PAY0TelegramBoundary${Date.now().toString(16)}`;
  const crlf = "\r\n";
  const chunks: Buffer[] = [];

  function addField(name: string, value: string) {
    chunks.push(Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="${multipartEscape(name)}"${crlf}${crlf}` +
      `${String(value || "")}${crlf}`,
      "utf8"
    ));
  }

  function addFile(name: string, uploadName: string, data: Buffer, mime: string) {
    chunks.push(Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="${multipartEscape(name)}"; filename="${multipartEscape(uploadName)}"${crlf}` +
      `Content-Type: ${mime || "application/octet-stream"}${crlf}${crlf}`,
      "utf8"
    ));
    chunks.push(data);
    chunks.push(Buffer.from(crlf, "utf8"));
  }

  addField("chat_id", chatId);

  if (caption) {
    addField("caption", caption.slice(0, 1024));
  }

  addFile("document", fileName || "documento.pdf", buffer, contentType || "application/pdf");

  chunks.push(Buffer.from(`--${boundary}--${crlf}`, "utf8"));

  const body = Buffer.concat(chunks);

  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body: body as any,
  } as any);

  const result = await response.json() as any;

  if (!response.ok || result?.ok !== true) {
    throw new Error(`Telegram sendDocument error: ${JSON.stringify(result)}`);
  }

  return result;
}
