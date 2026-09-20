"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Eye, Plus, UploadCloud, X } from "lucide-react";
import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "@/lib/firebaseClient";
import { uploadAssetDocument } from "@/lib/uploadAssetDocument";
import type { AssetDocumentType } from "@/services/assets";
import { AssetsEmpty, AssetsError, AssetsLoading } from "@/components/assets/AssetsStates";
import { useAssetsOverview } from "@/components/assets/useAssetsOverview";
import { dateLabel, displayPositionName, movementLabel } from "@/lib/assetsUi";

const TYPES: [AssetDocumentType, string][] = [
  ["ASSIGNMENT_OFFER", "Asignación / ofrecimiento"], ["LIQUIDATION", "Liquidación"],
  ["SPEI", "SPEI"], ["CEP", "CEP"], ["ACCOUNT_STATEMENT", "Estado de cuenta"],
  ["TRANSFER_RECEIPT", "Comprobante de transferencia"], ["OTHER", "Otro"],
];
const typeLabel = (value: string) => TYPES.find(([key]) => key === value)?.[1] || "Otro";
const createdDate = (value: any) => value?.toDate?.()?.toISOString?.() || (value?.seconds ? new Date(value.seconds * 1000).toISOString() : String(value || ""));

export default function DocumentsPage() {
  const { data, loading, error, reload } = useAssetsOverview();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState<number | null>(null); const [message, setMessage] = useState("");
  const [documentType, setDocumentType] = useState<AssetDocumentType>("ASSIGNMENT_OFFER"); const [relationType, setRelationType] = useState("POSITION"); const [relationId, setRelationId] = useState(""); const [description, setDescription] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const positions = data?.positions || [];
  const positionById = useMemo(() => new Map(positions.map((position) => [position.id, position])), [positions]);
  const movementById = useMemo(() => new Map((data?.movements || []).map((movement) => [movement.id, movement])), [data]);
  const docs = (data?.documents || []).filter((doc: any) => doc.status === "ACTIVE");
  if (loading && !data) return <AssetsLoading/>;
  if (error && !data) return <AssetsError message={error}/>;
  const relationName = (doc: any) => {
    if (doc.positionId && positionById.get(doc.positionId)) return displayPositionName(positionById.get(doc.positionId)!);
    if (doc.movementId && movementById.get(doc.movementId)) {
      const movement = movementById.get(doc.movementId)!;
      const position = positionById.get(movement.positionId);
      return `${movementLabel(movement.movementType)}${position ? ` · ${displayPositionName(position)}` : ""}`;
    }
    return doc.operationId ? "Operación relacionada" : "Sin relación";
  };
  const openFile = async (doc: any, download = false) => {
    try {
      const url = await getDownloadURL(ref(storage, doc.storagePath));
      const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
      if (download) link.download = doc.originalFileName || "documento";
      document.body.appendChild(link); link.click(); link.remove();
    } catch { setMessage("No se pudo abrir el documento."); }
  };
  const upload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return setMessage("Selecciona un archivo.");
    if (relationType !== "NONE" && !relationId) return setMessage("Selecciona el registro relacionado.");
    setBusy(true); setMessage(""); setProgress(0);
    try {
      const result = await uploadAssetDocument({
        file, documentType, description: description.trim() || undefined,
        positionId: relationType === "POSITION" ? relationId : undefined,
        movementId: relationType === "MOVEMENT" ? relationId : undefined,
        onProgress: setProgress,
      });
      setMessage(result.duplicate ? "Este archivo ya estaba guardado; no se duplicó." : "Documento cargado correctamente.");
      setOpen(false); setDescription(""); setRelationId(""); if (fileRef.current) fileRef.current.value = ""; await reload();
    } catch (value: any) { setMessage(value?.message || "No se pudo cargar el documento."); }
    finally { setBusy(false); setProgress(null); }
  };
  return <div className="space-y-3">
    <div className="flex justify-end"><button onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-[var(--assets-accent)] px-3 py-2 text-xs font-semibold text-[#111518]"><Plus size={15}/>Cargar documento</button></div>
    {message && <p className="rounded-lg border border-[var(--assets-border)] bg-white/[0.025] px-3 py-2 text-xs text-[var(--assets-secondary)]">{message}</p>}
    {docs.length ? <section className="assets-panel overflow-x-auto"><table className="w-full min-w-[780px] table-fixed text-left text-xs"><thead className="border-b border-[var(--assets-border)] bg-white/[0.025] text-[10px] uppercase tracking-wider text-[var(--assets-muted)]"><tr><th className="w-[105px] px-3 py-2 font-medium">Fecha</th><th className="px-3 py-2 font-medium">Documento</th><th className="w-[170px] px-3 py-2 font-medium">Tipo</th><th className="w-[220px] px-3 py-2 font-medium">Relacionado con</th><th className="w-[100px] px-3 py-2 text-right font-medium">Acciones</th></tr></thead><tbody className="divide-y divide-[var(--assets-border)]">{docs.map((doc: any) => <tr key={doc.id} className="hover:bg-white/[0.025]"><td className="px-3 py-2 text-[var(--assets-muted)]">{dateLabel(createdDate(doc.createdAt))}</td><td className="truncate px-3 py-2" title={doc.originalFileName}>{doc.originalFileName || doc.originalName || "Documento"}</td><td className="px-3 py-2 text-[var(--assets-secondary)]">{typeLabel(doc.documentType)}</td><td className="truncate px-3 py-2 text-[var(--assets-secondary)]">{relationName(doc)}</td><td className="px-3 py-2"><div className="flex justify-end gap-2"><button onClick={() => void openFile(doc)} title="Ver" className="text-[var(--assets-muted)] hover:text-white"><Eye size={15}/></button><button onClick={() => void openFile(doc, true)} title="Descargar" className="text-[var(--assets-muted)] hover:text-white"><Download size={15}/></button></div></td></tr>)}</tbody></table></section> : <AssetsEmpty>No hay documentos vinculados todavía.</AssetsEmpty>}
    {data?.truncated?.documents && <p className="text-[10px] text-[var(--assets-warning)]">Se muestran los 200 documentos disponibles en esta vista.</p>}
    {open && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true"><section className="assets-theme assets-panel w-full max-w-lg p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Cargar documento</h2><button disabled={busy} onClick={() => setOpen(false)} className="text-[var(--assets-muted)] hover:text-white"><X size={18}/></button></div><div className="mt-4 grid gap-3 text-xs"><label className="grid gap-1.5 text-[var(--assets-secondary)]">Archivo PDF, JPG o PNG (máx. 10 MB)<input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="assets-control p-2 text-xs file:mr-3 file:rounded-md file:border-0 file:bg-[var(--assets-accent-soft)] file:px-3 file:py-1.5 file:text-[var(--assets-text)]"/></label><label className="grid gap-1.5 text-[var(--assets-secondary)]">Tipo<select value={documentType} onChange={(event) => setDocumentType(event.target.value as AssetDocumentType)} className="assets-control p-2.5">{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-[var(--assets-secondary)]">Relacionar con<select value={relationType} onChange={(event) => { setRelationType(event.target.value); setRelationId(""); }} className="assets-control p-2.5"><option value="POSITION">Posición</option><option value="MOVEMENT">Movimiento</option><option value="NONE">Sin relación</option></select></label>{relationType !== "NONE" && <label className="grid gap-1.5 text-[var(--assets-secondary)]">Registro<select value={relationId} onChange={(event) => setRelationId(event.target.value)} className="assets-control min-w-0 p-2.5"><option value="">Selecciona…</option>{relationType === "POSITION" ? positions.map((position) => <option key={position.id} value={position.id}>{displayPositionName(position)}</option>) : (data?.movements || []).map((movement) => { const position = positionById.get(movement.positionId); return <option key={movement.id} value={movement.id}>{movementLabel(movement.movementType)}{position ? ` · ${displayPositionName(position)}` : ""}</option>; })}</select></label>}</div><label className="grid gap-1.5 text-[var(--assets-secondary)]">Descripción opcional<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={2} className="assets-control resize-none p-2.5"/></label>{progress !== null && <div><div className="h-1.5 overflow-hidden rounded-full bg-black/40"><div className="h-full bg-[var(--assets-accent)]" style={{ width: `${progress}%` }}/></div><p className="mt-1 text-[10px] text-[var(--assets-muted)]">{progress}%</p></div>}</div><div className="mt-5 flex justify-end gap-2"><button disabled={busy} onClick={() => setOpen(false)} className="px-3 py-2 text-xs text-[var(--assets-muted)]">Cancelar</button><button disabled={busy} onClick={() => void upload()} className="flex items-center gap-1.5 rounded-lg bg-[var(--assets-accent)] px-4 py-2 text-xs font-semibold text-[#111518] disabled:opacity-50"><UploadCloud size={15}/>{busy ? "Cargando…" : "Guardar"}</button></div></section></div>}
  </div>;
}
