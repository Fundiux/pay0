"use client";

import { formatDateTime24 } from "@/lib/dateTime";

import React, { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { prepareDocumentDeliveryJob } from "@/services/documentDelivery";
import { httpsCallable } from "firebase/functions";
import { Download, Trash2, UploadCloud, X } from "lucide-react";
import { db, functions, storage } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";
import {
  DISPERSION_DOCUMENT_TYPES,
  uploadDispersionDoc,
} from "@/lib/uploadDispersionDoc";

type UploadRow = {
  id: string;
  documentType?: string | null;
  documentTypeLabel?: string | null;
  filename?: string | null;
  originalName?: string | null;
  status?: string | null;
  active?: boolean | null;
  version?: number | null;
  createdAt?: any;
  finalizedAt?: any;
  storagePath?: string | null;
};

type DispersionLike = {
  id: string;
  folio?: string | null;
  dispersionFolio?: string | null;
  clienteId?: string | null;
  clienteNombre?: string | null;
  beneficiaryNombre?: string | null;
  amount?: number | null;
};

function formatDate(value: any) {
  return formatDateTime24(value, "---");
}

function getTypeLabel(type: string) {
  return DISPERSION_DOCUMENT_TYPES.find((x) => x.value === type)?.label || type || "Documento";
}

function getAccept() {
  return DISPERSION_DOCUMENT_TYPES[0]?.accept || "*/*";
}

export default function DispersionDocsModal(props: {
  open: boolean;
  onClose: () => void;
  dispersion: DispersionLike | null;
}) {
  const { open, onClose, dispersion } = props;
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [docs, setDocs] = useState<UploadRow[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deliveryBusyId, setDeliveryBusyId] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  const dispersionId = dispersion?.id || "";

  const title = useMemo(() => {
    if (!dispersion) return "Docs";
    return `Docs - ${dispersion.folio || dispersion.dispersionFolio || dispersion.id}`;
  }, [dispersion]);

  useEffect(() => {
    if (!open || !dispersionId) {
      setDocs([]);
      return;
    }

    const qDocs = query(
      collection(db, "uploads"),
      where("dispersionId", "==", dispersionId)
    );

    return onSnapshot(
      qDocs,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter((x: any) => String(x.entityType || "") === "clientDispersions")
          .filter((x: any) => String(x.documentType || "") === "COMPROBANTE_DISPERSION")
          .sort((a: any, b: any) => {
            const at = Number(a.finalizedAt?.seconds || a.createdAt?.seconds || 0);
            const bt = Number(b.finalizedAt?.seconds || b.createdAt?.seconds || 0);
            return bt - at;
          }) as UploadRow[];

        setDocs(rows);
      },
      () => setDocs([])
    );
  }, [open, dispersionId]);

  useEffect(() => {
    if (!open) {
      setPct(0);
      setBusy(false);
      setDownloadingId(null);
      setDeactivatingId(null);
    }
  }, [open]);

  if (!open) return null;

  const activeDocs = docs.filter((doc) => doc.active !== false && String(doc.status || "") !== "INACTIVE");


  async function prepareDispersionWhatsapp(doc: any) {
    if (!doc?.storagePath) {
      alert("El comprobante no tiene archivo disponible para preparar envio.");
      return;
    }

    const docId = String(doc.id || doc.storagePath || "active");
    setDeliveryBusyId(docId);

    try {
      const dispersion = (props as any).dispersion || {};
      const result = await prepareDocumentDeliveryJob({
        sourceType: "DISPERSION_COMPROBANTE",
        sourceId: String(dispersion.id || dispersion.dispersionId || ""),
        clienteId: String(dispersion.clienteId || dispersion.clientId || ""),
        clienteNombre: String(dispersion.clienteNombre || dispersion.clientName || ""),
        targetLabel: dispersion.clienteNombre || dispersion.clientName ? String(dispersion.clienteNombre || dispersion.clientName) : "WhatsApp cliente",
        documents: [
          {
            name: String(doc.originalName || doc.filename || doc.fileName || doc.storagePath.split("/").pop() || "comprobante-dispersion"),
            fileName: String(doc.originalName || doc.filename || doc.fileName || doc.storagePath.split("/").pop() || "comprobante-dispersion"),
            contentType: doc.contentType || null,
            storagePath: doc.storagePath,
            documentType: "COMPROBANTE_DISPERSION",
          },
        ],
        notes: "Preparado desde comprobante de dispersion. No enviar automaticamente.",
      });

      alert("Envio WhatsApp preparado: " + result.message);
    } catch (err: any) {
      alert(err?.message || "No se pudo preparar el envio WhatsApp.");
    } finally {
      setDeliveryBusyId(null);
    }
  }

  const downloadDoc = async (doc: UploadRow) => {
    if (!doc.storagePath) {
      alert("Documento sin ruta de Storage.");
      return;
    }

    setDownloadingId(doc.id);

    try {
      const url = await getDownloadURL(ref(storage, doc.storagePath));
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      console.error("Download dispersion doc error", err);
      alert(err?.message || "No se pudo descargar el archivo.");
    } finally {
      setDownloadingId(null);
    }
  };

  const deactivateDoc = async (doc: UploadRow) => {
    if (!doc.id) return;

    const ok = window.confirm("Desactivar este comprobante?");
    if (!ok) return;

    setDeactivatingId(doc.id);

    try {
      const callable = httpsCallable(functions, CALLABLES.deactivateDispersionDocument);
      await callable({ uploadId: doc.id });
    } catch (err: any) {
      console.error("Deactivate dispersion doc error", err);
      alert(err?.message || "No se pudo desactivar el comprobante.");
    } finally {
      setDeactivatingId(null);
    }
  };

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !dispersionId) return;

    setBusy(true);
    setPct(0);

    try {
      await uploadDispersionDoc({
        dispersionId,
        file,
        onProgress: setPct,
      });
    } catch (err: any) {
      console.error("Upload dispersion doc error", err);
      alert(err?.message || "No se pudo subir el archivo.");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0f1624] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-[12px] font-semibold text-white">{title}</div>
            <div className="mt-1 text-[10px] uppercase tracking-widest text-slate-500">
              Comprobantes de dispersion
            </div>
          </div>

          <button
            onClick={() => !busy && onClose()}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
            title="Cerrar"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Subir comprobante
            </div>

            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 px-3 py-4 text-sm text-slate-300 transition hover:border-sky-500 hover:text-sky-300">
              <UploadCloud size={16} />
              <span>{busy ? `Subiendo ${pct}%` : "Seleccionar archivo"}</span>
              <input
                type="file"
                className="hidden"
                accept={getAccept()}
                disabled={busy}
                onChange={pick}
              />
            </label>

            <div className="mt-2 text-[11px] text-slate-500">
              Max 1 MB. Si subes otro comprobante, reemplaza la version activa anterior.
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10">
            <div className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Comprobantes cargados
            </div>

            {activeDocs.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500">Sin comprobantes cargados.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="bg-white/[0.03] text-[10px] uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Tipo</th>
                      <th className="px-3 py-2 text-center">Version</th>
                      <th className="px-3 py-2 text-center">Estatus</th>
                      <th className="px-3 py-2 whitespace-nowrap">Fecha</th>
                      <th className="px-3 py-2 text-right">Acc.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDocs.map((doc) => (
                      <tr key={doc.id} className="border-t border-white/5 text-slate-300">
                        <td className="px-3 py-2">{doc.documentTypeLabel || getTypeLabel(String(doc.documentType || ""))}</td>
                        <td className="px-3 py-2 text-center">{doc.version || "---"}</td>
                        <td className="px-3 py-2 text-center">{doc.status || "---"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(doc.finalizedAt || doc.createdAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => downloadDoc(doc)}
                              disabled={downloadingId === doc.id}
                              className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 hover:text-emerald-400 disabled:opacity-40"
                              title="Descargar"
                              aria-label="Descargar"
                            >
                              <Download size={16} strokeWidth={1.8} />
                            </button>
                            <button
                              type="button"
                              onClick={() => prepareDispersionWhatsapp(doc)}
                              disabled={deliveryBusyId === String(doc.id || doc.storagePath || "active") || !doc.storagePath}
                              className="rounded-lg border border-emerald-500/40 px-3 py-1 text-[12px] text-emerald-200 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {deliveryBusyId === String(doc.id || doc.storagePath || "active") ? "Preparando..." : "Preparar WhatsApp"}
                            </button>

                            <button
                              type="button"
                              onClick={() => deactivateDoc(doc)}
                              disabled={deactivatingId === doc.id}
                              className="inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 hover:text-rose-400 disabled:opacity-40"
                              title="Desactivar"
                              aria-label="Desactivar"
                            >
                              <Trash2 size={16} strokeWidth={1.8} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}