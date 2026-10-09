"use client";

import { useEffect, useRef, useState } from "react";

const endpoint = "https://us-central1-pay-0-system.cloudfunctions.net/telegramDownloadAction";
// Runs when this client module loads, before rendering or any download request.
// Keep this page free of analytics and other dependencies that inspect location.
function captureDownloadFragment() {
  if (typeof window === "undefined" || window.location.pathname !== "/descarga/documento") return "";
  const fragment = window.location.hash;
  window.history.replaceState(null, "", window.location.pathname);
  return /^#token=([A-Za-z0-9_-]{43})$/.exec(fragment)?.[1] || "";
}
let pendingToken = captureDownloadFragment();
export default function DocumentDownloadPage() {
  const token = useRef("");
  const busy = useRef(false);
  const initialized = useRef(false);
  const generation = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "downloading" | "done" | "error">("loading");
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      activeRequest.current?.abort();
      activeRequest.current = null;
      busy.current = false;
    };
    const changed = (event: HashChangeEvent) => {
      // Ignore queued events superseded by a later navigation or our history replacement.
      if (event.newURL && event.newURL !== window.location.href) return;
      const next = captureDownloadFragment();
      invalidate();
      token.current = next;
      setState(next ? "ready" : "error");
    };
    // StrictMode cleanup/re-entry must reattach the listener without losing the captured token.
    if (!initialized.current) {
      initialized.current = true;
      token.current = window.location.hash ? captureDownloadFragment() : pendingToken;
      pendingToken = "";
      setState(token.current ? "ready" : "error");
    }
    window.addEventListener("hashchange", changed);
    return () => {
      window.removeEventListener("hashchange", changed);
      invalidate();
    };
  }, []);

  async function download() {
    if (!token.current || busy.current) return;
    busy.current = true;
    const attempt = ++generation.current;
    const controller = new AbortController();
    activeRequest.current = controller;
    const current = () => generation.current === attempt && !controller.signal.aborted;
    setState("downloading");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.current }), signal: controller.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      });
      if (!current()) return;
      if (!response.ok) throw new Error("DOWNLOAD_UNAVAILABLE");
      const blob = await response.blob();
      if (!current()) return;
      const disposition = response.headers.get("Content-Disposition") || "";
      let name = "documento";
      try { name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] || "documento"); } catch { /* Safe fallback. */ }
      name = name.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "_").slice(0, 180) || "documento";
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl; anchor.download = name; anchor.rel = "noreferrer";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      token.current = "";
      setState("done");
    } catch {
      // Do not display provider responses, tokens, URLs or raw exceptions.
      if (current()) setState("error");
    } finally {
      if (generation.current === attempt) {
        busy.current = false;
        activeRequest.current = null;
      }
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#0b1220] px-6 text-slate-100">
    <section className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8">
      <p className="mb-3 text-sm font-semibold text-slate-400">PAY0</p>
      <h1 className="text-xl font-semibold">Descargar documento</h1>
      <p className="mt-3 text-sm text-slate-300" role="status" aria-live="polite">
        {state === "loading" ? "Preparando enlace..." : state === "ready" ? "El enlace es temporal y permite una descarga."
          : state === "downloading" ? "Preparando descarga..." : state === "done" ? "La descarga se ha enviado a tu navegador."
            : "No se pudo descargar el documento. Solicita un enlace nuevo en Telegram."}
      </p>
      {(state === "ready" || state === "downloading") && <button type="button" onClick={() => void download()} disabled={state === "downloading"}
        className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500 disabled:opacity-50">{state === "downloading" ? "Descargando..." : "Descargar"}</button>}
    </section>
  </main>;
}
