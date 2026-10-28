"use client";

import { useEffect, useState } from "react";
import { getTelegramInitData, type MatBotScope } from "@/lib/telegramMiniApp";
import { getMatSolicitudDocuments, type MatSolicitudDocument } from "@/services/telegramMiniApp";

export function MatSolicitudDocuments({ solicitudId, folio, scope, onClose }: { solicitudId: string; folio: string; scope: MatBotScope; onClose: () => void }) {
  const [documents, setDocuments] = useState<MatSolicitudDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const initData = getTelegramInitData();
    if (!initData) {
      setLoading(false);
      setError("Abre esta solicitud desde Telegram para consultar sus documentos.");
      return;
    }
    getMatSolicitudDocuments({ initData, botScope: scope, solicitudId })
      .then((result) => { if (!cancelled) setDocuments(result.documents); })
      .catch(() => { if (!cancelled) setError("No se pudieron consultar los documentos de esta solicitud."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [solicitudId, scope]);

  return <div role="dialog" aria-modal="true" aria-label="Documentos de solicitud" className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
    <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#161d2b] p-5">
      <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-lg font-black text-white">Documentos</h2><p className="text-xs text-slate-400">{folio}</p></div><button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full bg-slate-950 px-3 py-1 text-slate-300">×</button></div>
      {loading ? <p className="text-sm text-slate-400">Cargando documentos…</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : null}
      {!loading && !error && !documents.length ? <p className="text-sm text-slate-400">Esta solicitud no tiene documentos disponibles.</p> : null}
      <div className="space-y-2">{documents.map((document) => <div key={document.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
        <div className="truncate text-sm font-semibold text-white">{document.name}</div><div className="mb-2 text-xs text-slate-400">{document.type}</div>
        <div className="flex gap-3 text-sm"><a href={document.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300">Abrir o descargar</a>{typeof navigator !== "undefined" && typeof navigator.share === "function" ? <button type="button" onClick={() => void navigator.share({ title: document.name, url: document.url }).catch(() => {})} className="text-cyan-300">Compartir</button> : null}</div>
      </div>)}</div>
      {documents.length ? <p className="mt-4 text-xs text-slate-500">Los enlaces caducan después de cinco minutos. Vuelve a abrir la solicitud para renovarlos.</p> : null}
    </div>
  </div>;
}
