import * as https from "https";

export type TelegramTransportOptions = { signal?: AbortSignal };
// Cancellation after dispatch is an uncertain delivery, never permission to retry.
function transportError(): Error { return new Error("TELEGRAM_DELIVERY_UNCONFIRMED"); }
function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw transportError();
}
function postJson(url: string, body: Record<string, any>, options: TelegramTransportOptions): Promise<any> {
  return new Promise((resolve, reject) => {
    let req: ReturnType<typeof https.request> | undefined;
    let response: import("http").IncomingMessage | undefined;
    let settled = false;
    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    const fail = () => {
      if (settled) return;
      settled = true; cleanup(); reject(transportError());
      response?.destroy(); req?.destroy();
    };
    const abort = () => fail();
    try {
      assertNotAborted(options.signal);
      const payload = JSON.stringify(body);
      options.signal?.addEventListener("abort", abort, { once: true });
      assertNotAborted(options.signal);
      req = https.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      }, (res) => {
        response = res;
        res.on("error", fail);
        res.on("aborted", fail);
        if (settled) { res.destroy(); return; }
        const status = Number(res.statusCode || 0);
        if (status < 200 || status >= 300) { fail(); return; }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          if (!settled) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          if (settled) return;
          try {
            assertNotAborted(options.signal);
            const raw = Buffer.concat(chunks).toString("utf8");
            let parsed: any = {};
            // Preserve the existing non-throwing 2xx contract without exposing
            // raw provider material or introducing new retry paths in callers.
            try { parsed = raw ? JSON.parse(raw) : {}; } catch { /* sanitized empty result */ }
            settled = true; cleanup(); resolve(parsed);
          } catch { fail(); }
        });
        res.on("close", () => { if (!settled) fail(); });
      });
      req.on("error", fail);
      if (settled || options.signal?.aborted) { fail(); req.destroy(); return; }
      req.write(payload); req.end();
    } catch { fail(); }
  });
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  options: TelegramTransportOptions = {}
): Promise<any> {
  assertNotAborted(options.signal);
  const token = String(botToken || "").trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN no configurado.");
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  return await postJson(url, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  }, options);
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
  inlineKeyboard: TelegramInlineKeyboardButton[][],
  options: TelegramTransportOptions = {}
): Promise<any> {
  assertNotAborted(options.signal);
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
  }, options);
}
function multipartEscape(value: string): string {
  return String(value || "").replace(/["\r\n]/g, "");
}

export async function sendTelegramDocumentBuffer(
  botToken: string,
  chatId: string,
  fileName: string,
  buffer: Buffer,
  contentType: string,
  caption?: string,
  options: TelegramTransportOptions = {}
): Promise<any> {
  assertNotAborted(options.signal);
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

  if (/[\r\n]/.test(contentType)) throw transportError();

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

  try {
  assertNotAborted(options.signal);
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    signal: options.signal,
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body: body as any,
  } as any);

  if (!response.ok) {
    await response.body?.cancel();
    throw transportError();
  }
  const result = await response.json() as any;
  assertNotAborted(options.signal);

  if (!response.ok || result?.ok !== true) {
    throw transportError();
  }

  return result;
  } catch { throw transportError(); }
}
