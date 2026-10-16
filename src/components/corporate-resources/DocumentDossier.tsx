"use client";

import { useState } from "react";
import { listOperationalDocuments, type DossierDocument } from "@/services/documentDossier";
import { getAuthorizedDocumentDownloadUrl } from "@/services/authorizedDocuments";

const button = "rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40";
export default function DocumentDossier() {
  const [rows, setRows] = useState<DossierDocument[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [search, setSearch] = useState(""), [origin, setOrigin] = useState("");
  async function load(more = false) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await listOperationalDocuments(more ? cursor || undefined : undefined);
      setRows(previous => [...new Map([...(more ? previous : []), ...result.documents].map(row => [row.id, row])).values()]);
      setCursor(result.nextCursor); setLoaded(true);
    } catch { setError("No se pudo consultar el expediente. Revisa tu acceso e intenta nuevamente."); }
    finally { setBusy(false); }
  }
  async function download(id: string) {
    setBusy(true); setError("");
    const destination = window.open("about:blank", "_blank");
    if (destination) destination.opener = null;
    try {
      const url = await getAuthorizedDocumentDownloadUrl(id);
      if (!/^https:\/\//i.test(url)) throw new Error("Enlace de descarga inválido.");
      if (destination) destination.location.href = url;
      else setError("Permite abrir ventanas para descargar el documento y vuelve a intentarlo.");
    } catch (e) { destination?.close(); setError(e instanceof Error ? e.message : "No se pudo descargar el documento."); }
    finally { setBusy(false); }
  }
  const needle = search.trim().toLocaleLowerCase("es");
  const visible = rows.filter(row => (!origin || row.origin === origin) && [row.name, row.folio, row.iqFolio, row.company, row.client, row.documentType].join(" ").toLocaleLowerCase("es").includes(needle));
  return <section className="space-y-3 rounded-xl border border-white/10 p-4" aria-label="Expediente operativo">
    <h2 className="font-semibold">Expediente operativo · IQ y PAY0</h2>
    <p className="text-sm text-slate-400">Consulta archivos finalizados y activos vinculados a solicitudes, pagos y dispersiones. Los documentos de la empresa se administran abajo, en Recursos disponibles. La procedencia IQ se muestra cuando está registrada en la importación.</p>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={() => void load()}>{loaded ? "Actualizar expediente" : "Consultar expediente"}</button>
      <input className="rounded-lg border border-white/15 bg-slate-950 p-2 text-sm" aria-label="Buscar en documentos cargados" placeholder="Folio, empresa, cliente o archivo" value={search} onChange={e => setSearch(e.target.value)}/>
      <select className="rounded-lg border border-white/15 bg-slate-950 p-2 text-sm" aria-label="Procedencia documental" value={origin} onChange={e => setOrigin(e.target.value)}><option value="">Todas las procedencias</option><option value="IQ">Importados de IQ</option><option value="PAY0">Otros registros de PAY0</option></select>
    </div>
    {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
    {loaded && <p role="status" className="text-xs text-slate-400">{visible.length} visibles de {rows.length} documentos cargados. Los filtros buscan en lo cargado.{cursor ? " Hay más registros por consultar." : " Se terminó de recorrer el inventario disponible."}</p>}
    {visible.map(row => <article key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white/5 p-3">
      <div><p className="break-all text-sm font-medium">{row.name}</p><p className="text-xs text-slate-400">{row.origin === "IQ" ? `Importado de IQ${row.iqFolio ? ` · ${row.iqFolio}` : ""}` : "Registrado en PAY0"} · {row.folio || "Sin folio registrado"}{row.version ? ` · v${row.version}` : ""}</p><p className="text-xs text-slate-400">{[row.company, row.client, row.documentType].filter(Boolean).join(" · ")}</p></div>
      <button className={button} disabled={busy} onClick={() => void download(row.id)}>Descargar</button>
    </article>)}
    {loaded && !visible.length && <p className="text-sm text-slate-400">No hay documentos coincidentes en esta consulta.{cursor ? " Continúa cargando registros." : " Los archivos que aún no se han incorporado a PAY0 no aparecen aquí."}</p>}
    {cursor && <button className={button} disabled={busy} onClick={() => void load(true)}>Cargar más registros</button>}
  </section>;
}
