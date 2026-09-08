"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { Download, FileText, Trash2, UploadCloud, X } from "lucide-react";

import { db, functions, storage } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";
import UiSelect from "@/components/UiSelect";
import { PagoDocumentType, uploadPagoDoc } from "@/lib/uploadPagoDoc";
import { useGlobalLoading } from "@/components/GlobalLoading";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole } from "@/lib/roles";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { requestPagoIqSync } from "@/services/iq";

type UploadRow = {
  id: string;
  documentType?: string | null;
  documentTypeLabel?: string | null;
  originalName?: string | null;
  filename?: string | null;
  storagePath?: string | null;
  status?: string | null;
  active?: boolean | null;
  version?: number | null;
  sizeBytes?: number | null;
  finalizedAt?: any;
  createdAt?: any;
  entityType?: string | null;
  pagoId?: string | null;
  iqTerminalFolio?: string | null;
  iqTerminalStatus?: string | null;
  iqTerminalReason?: string | null;
  iqRetryForTerminalFolio?: string | null;
  iqRetryForTerminalStatus?: string | null;
  documentStateLabel?: string | null;
};

function tsMs(value: any): number {
  if (value?.seconds) return Number(value.seconds) * 1000;
  if (value instanceof Date) return value.getTime();
  return 0;
}

function formatDate(value: any): string {
  const ms = tsMs(value);
  if (!ms) return "---";
  return new Date(ms).toLocaleString();
}

function formatSize(bytes: any): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "---";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatMoney(value: any): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getPagoFolio(pago: any): string {
  return String(pago?.folio || pago?.referenceFolio || pago?.pagoFolio || pago?.id || pago?.pagoId || "---");
}

export default function PagoDocsModal(props: {
  open: boolean;
  onClose: () => void;
  pago: any | null;
}) {
  const { open, onClose, pago } = props;

  const { profile } = useUserProfile();
  const globalLoading = useGlobalLoading();
  const iqRole = normalizeRole((profile as any)?.role);
  const isIqSuperAdmin = iqRole === "superadmin";
  const { modules: iqModules } = useModuleAccess(profile, "pagos", "view");
  const isIqOperationalRole = ["superadmin", "admin", "operador"].includes(iqRole);
  const canCreateIqPago = isIqOperationalRole && !!iqModules?.pagos?.create;
  const canConciliateIqPago = isIqOperationalRole && !!iqModules?.pagos?.conciliate;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [docs, setDocs] = useState<UploadRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [iqBusy, setIqBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");
  const [documentType, setDocumentType] = useState<PagoDocumentType>("COMPROBANTE_PAGO");
  const [otherLabel, setOtherLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [livePago, setLivePago] = useState<any | null>(null);
  const [correctedAmount, setCorrectedAmount] = useState("");
  const [amountReason, setAmountReason] = useState("");
  const [amountBusy, setAmountBusy] = useState(false);

  const pagoId = String(pago?.id || pago?.pagoId || "").trim();
  const currentPago = livePago || pago;
  const pagoFolio = getPagoFolio(currentPago);

  const visibleDocs = useMemo(() => {
    return docs
      .filter((row) => String(row.entityType || "") === "pagos")
      .sort((a, b) => {
        const activeA = a.active === false ? 0 : 1;
        const activeB = b.active === false ? 0 : 1;
        if (activeA !== activeB) return activeB - activeA;
        return tsMs(b.finalizedAt || b.createdAt) - tsMs(a.finalizedAt || a.createdAt);
      });
  }, [docs]);

  const hasActiveReceipt = useMemo(() => {
    return visibleDocs.some((row) => {
      return (
        String(row.documentType || "").toUpperCase() === "COMPROBANTE_PAGO" &&
        row.active !== false &&
        !!row.storagePath
      );
    });
  }, [visibleDocs]);

  const terminalText = [
    currentPago?.status,
    currentPago?.iqDepositStatus,
    currentPago?.iqDepositReconciliationStatus,
    currentPago?.iqDepositOperationStatus,
    currentPago?.iqDepositTerminalStatus,
  ].map((value) => String(value || "")).join(" ").toUpperCase();

  const isTerminalLocked = currentPago?.iqDepositTerminalLocked === true ||
    /RECHAZ|REJECT|CANCEL/.test(terminalText);
  const terminalOutcome = /CANCEL/.test(terminalText)
    ? "CANCELLED"
    : /RECHAZ|REJECT/.test(terminalText) || isTerminalLocked
      ? "REJECTED"
      : "";
  const terminalIqId = String(
    currentPago?.iqDepositId ||
    currentPago?.iqDepositFolio ||
    currentPago?.iqPagoDepositId ||
    currentPago?.iqPagoDepositFolio ||
    currentPago?.iqDepositTerminalLockedIqId ||
    "",
  ).trim();
  const terminalReason = String(
    currentPago?.iqDepositTerminalReason ||
    currentPago?.iqDepositRejectionReason ||
    currentPago?.rejectionReason ||
    currentPago?.cancellationReason ||
    "",
  ).trim();
  const iqPagoStatus = String(currentPago?.status || "").trim().toUpperCase();

  const iqAutomationOmitted =
    currentPago?.iqDepositOmitted === true ||
    currentPago?.iqDepositAutomationOmitted === true ||
    [
      currentPago?.iqDepositStatus,
      currentPago?.iqDepositSyncStatus,
      currentPago?.iqDepositUploadStatus,
      currentPago?.iqDepositFollowupStatus,
      currentPago?.iqDepositReconciliationStatus,
    ].some((value) => String(value || "").trim().toUpperCase() === "OMITTED");

  const iqReferenceText = String(
    currentPago?.iqDepositId ??
    currentPago?.iqDepositFolio ??
    currentPago?.iqPagoDepositId ??
    currentPago?.iqPagoDepositFolio ??
    "",
  ).trim();

  const normalizedIqReference = /^\d{5,9}$/.test(iqReferenceText)
    ? iqReferenceText
    : iqReferenceText.match(/\b([1-9]\d{4,8})\b/)?.[1] || "";

  const iqCreationStatus = String(
    currentPago?.iqDepositCreationStatus || "",
  ).trim().toUpperCase();

  const iqSyncEligible =
    iqPagoStatus === "CONCILIACION_PENDIENTE" &&
    !iqAutomationOmitted &&
    !isTerminalLocked;

  const iqShouldReconcile =
    iqSyncEligible &&
    (Boolean(normalizedIqReference) ||
      iqCreationStatus === "CREATED" ||
      iqCreationStatus === "CREATED_RECOVERED" ||
      iqCreationStatus === "OUTCOME_UNKNOWN" ||
      currentPago?.iqDepositCreationRetryBlocked === true);

  const iqManualCreateProtectedStatuses = new Set([
    "PROCESSING_HTTP",
    "POST_ACKNOWLEDGED_PENDING_IQ_ID",
    "OUTCOME_UNKNOWN",
    "AMBIGUOUS",
    "CLOCK_CONTRADICTION_REVIEW_REQUIRED",
    "CREATED",
    "CREATED_RECOVERED",
    "TERMINAL_CANCELLED",
    "TERMINAL_REJECTED",
  ]);

  const iqCanCreateManually =
    iqSyncEligible &&
    !normalizedIqReference &&
    currentPago?.iqDepositCreationRetryBlocked !== true &&
    !iqManualCreateProtectedStatuses.has(iqCreationStatus);

  const canSyncIqPago = iqShouldReconcile
    ? canConciliateIqPago
    : iqCanCreateManually && canCreateIqPago;

  const canCorrectRejectedAmount = isIqSuperAdmin &&
    isTerminalLocked &&
    terminalOutcome === "REJECTED" &&
    String(currentPago?.status || "").toUpperCase() === "RECHAZADO";

  useEffect(() => {
    if (!open || !pagoId) {
      setLivePago(null);
      return;
    }

    return onSnapshot(
      doc(db, "pagos", pagoId),
      (snap) => {
        setLivePago(snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null);
      },
      (err) => {
        setMsg(err?.message || "No se pudo actualizar el pago.");
      },
    );
  }, [open, pagoId]);

  useEffect(() => {
    if (!open) return;
    const amount = Number(currentPago?.montoTotal || 0);
    setCorrectedAmount(Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : "");
  }, [open, pagoId, currentPago?.montoTotal]);

  useEffect(() => {
    if (!open || !pagoId) {
      setDocs([]);
      return;
    }

    const qDocs = query(collection(db, "uploads"), where("pagoId", "==", pagoId));

    return onSnapshot(
      qDocs,
      (snap) => {
        setDocs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      },
      (err) => {
        setMsg(err?.message || "No se pudieron cargar documentos del pago.");
      }
    );
  }, [open, pagoId]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !iqBusy && !amountBusy) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, iqBusy, amountBusy, onClose]);

  useEffect(() => {
    if (!open) {
      setDocs([]);
      setBusy(false);
      setIqBusy(false);
      setPct(0);
      setMsg("");
      setDocumentType("COMPROBANTE_PAGO");
      setOtherLabel("");
      setFile(null);
      setDragActive(false);
      setLivePago(null);
      setCorrectedAmount("");
      setAmountReason("");
      setAmountBusy(false);
    }
  }, [open]);

  function selectPagoDocFile(nextFile: File | null) {
    if (!nextFile) {
      setFile(null);
      return;
    }

    const name = String(nextFile.name || "").toLowerCase();
    const type = String(nextFile.type || "").toLowerCase();
    const isReceipt = documentType === "COMPROBANTE_PAGO";
    const receiptAllowed =
      type === "application/pdf" ||
      type.startsWith("image/") ||
      /\.(pdf|jpg|jpeg|png|webp)$/.test(name);

    if (isReceipt && !receiptAllowed) {
      setFile(null);
      setMsg("El comprobante debe ser PDF, JPG, PNG o WEBP.");
      return;
    }

    if (nextFile.size > 1 * 1024 * 1024) {
      setFile(null);
      setMsg("El archivo excede el limite de 1 MB.");
      return;
    }

    setMsg("");
    setFile(nextFile);
  }
  async function onUpload() {
    if (!pagoId || busy || iqBusy) return;

    setMsg("");

    if (!file) {
      setMsg("Selecciona un archivo.");
      return;
    }

    if (documentType === "OTRO" && !otherLabel.trim()) {
      setMsg("Captura el nombre del documento.");
      return;
    }

    try {
      setBusy(true);
      setPct(0);

      await uploadPagoDoc({
        pagoId,
        documentType,
        customDocumentTypeLabel: documentType === "OTRO" ? otherLabel.trim() : "",
        file,
        onProgress: setPct,
      });

      setFile(null);
      setOtherLabel("");
      setDocumentType("COMPROBANTE_PAGO");
      setPct(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setMsg(
        isTerminalLocked && documentType === "COMPROBANTE_PAGO"
          ? "Nuevo comprobante subido. El folio anterior quedo historico y se habilito un nuevo intento."
          : "Documento subido correctamente.",
      );
    } catch (e: any) {
      setMsg(e?.message || "No se pudo subir el documento.");
    } finally {
      setBusy(false);
    }
  }

  async function updateRejectedAmount() {
    if (!canCorrectRejectedAmount || !pagoId || amountBusy || busy || iqBusy) return;

    const newAmount = Number(String(correctedAmount || "").replace(/[$,\s]/g, ""));
    const currentAmount = Number(currentPago?.montoTotal || 0);
    const reason = amountReason.trim();

    setMsg("");

    if (!Number.isFinite(newAmount) || newAmount <= 0) {
      setMsg("Captura un monto valido.");
      return;
    }

    if (Math.round(newAmount * 100) === Math.round(currentAmount * 100)) {
      setMsg("El monto corregido es igual al monto actual.");
      return;
    }

    if (reason.length < 3) {
      setMsg("Indica el motivo de la correccion.");
      return;
    }

    const ok = window.confirm(
      `Corregir el monto de $${formatMoney(currentAmount)} a $${formatMoney(newAmount)}? El pago seguira bloqueado hasta subir un nuevo comprobante.`,
    );
    if (!ok) return;

    try {
      setAmountBusy(true);
      const fn = httpsCallable(functions, CALLABLES.updateRejectedPagoAmountForRetry);
      const res = await fn({
        pagoId,
        montoTotal: newAmount,
        reason,
      });
      const data = (res.data as any) || {};

      setCorrectedAmount(Number(data.newAmount || newAmount).toFixed(2));
      setAmountReason("");
      setMsg(
        `Monto corregido de $${formatMoney(data.previousAmount || currentAmount)} a $${formatMoney(data.newAmount || newAmount)}. Ahora sube el nuevo comprobante.`,
      );
    } catch (e: any) {
      setMsg(e?.message || "No se pudo corregir el monto.");
    } finally {
      setAmountBusy(false);
    }
  }

  async function openDoc(row: UploadRow) {
    if (!row.storagePath) {
      setMsg("Documento sin ruta de Storage.");
      return;
    }

    try {
      setMsg("");
      const url = await getDownloadURL(ref(storage, row.storagePath));
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo abrir el documento.");
    }
  }

  async function deactivateDoc(row: UploadRow) {
    if (!row.id || busy || iqBusy) return;

    const ok = window.confirm("Desactivar este documento del pago?");
    if (!ok) return;

    try {
      setBusy(true);
      setMsg("");

      const fn = httpsCallable(functions, CALLABLES.deactivatePagoDocument);
      await fn({ uploadId: row.id });

      setMsg("Documento desactivado.");
    } catch (e: any) {
      setMsg(e?.message || "No se pudo desactivar el documento.");
    } finally {
      setBusy(false);
    }
  }

  async function runIqPagoSync() {
    if (!canSyncIqPago || !pagoId || iqBusy) return;

    setIqBusy(true);
    setMsg("");

    try {
      const requested = await requestPagoIqSync(pagoId);

      setMsg(
        requested.data.operation === "CREATE"
          ? "Creacion de deposito IQ enviada. PAY0 continuara el proceso en segundo plano."
          : "Sincronizacion IQ enviada. PAY0 continuara el proceso en segundo plano.",
      );
    } catch (e: any) {
      setMsg(
        e?.message ||
          "No se pudo iniciar la sincronizacion IQ.",
      );
    } finally {
      setIqBusy(false);
    }
  }
  if (!open || !pago) return null;

  const accept =
    documentType === "COMPROBANTE_PAGO"
      ? "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp"
      : "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp,.xml,.xls,.xlsx,.csv,.doc,.docx,.txt";

  const fileLabel = file ? file.name : "Seleccionar archivo";

  return (
    <div
      className="fixed inset-0 z-[1320] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy && !iqBusy && !amountBusy) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-[760px] overflow-visible rounded-2xl border border-white/10 bg-[#161d2b] shadow-2xl shadow-black/50">
        <button
          type="button"
          onClick={onClose}
          disabled={busy || iqBusy || amountBusy}
          className="absolute -right-2 -top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400 shadow-lg shadow-black/40 transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Cerrar"
          title="Cerrar"
        >
          <X size={16} strokeWidth={1.9} />
        </button>

        <div className="border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2 text-[12px] font-normal text-white">
            <FileText size={14} />
            Docs - {pagoFolio}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.12em] text-slate-500">
            DOCUMENTOS POR TIPO
          </div>
          <div className="mt-1 truncate text-[10px] text-slate-400">
            {currentPago?.clienteNombre || "---"} - {currentPago?.empresaNombre || "---"}
          </div>
        </div>

        <div className="max-h-[82vh] space-y-4 overflow-auto p-5">
          {msg && (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[12px] leading-5 text-slate-200">
              {msg}
            </div>
          )}

          {isTerminalLocked ? (
            <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4">
              <div className="text-sm font-semibold text-rose-100">
                {terminalOutcome === "CANCELLED" ? "Deposito cancelado" : "Deposito rechazado"}
              </div>
              <div className="mt-1 text-xs leading-5 text-rose-100/80">
                {terminalIqId ? `Folio IQ ${terminalIqId}. ` : ""}
                El seguimiento automatico esta cerrado. El comprobante actual queda como historico cuando se suba uno nuevo.
              </div>
              {terminalReason ? (
                <div className="mt-2 rounded-xl border border-rose-300/20 bg-black/20 px-3 py-2 text-[11px] text-rose-100/80">
                  Motivo: {terminalReason}
                </div>
              ) : null}

              {canCorrectRejectedAmount ? (
                <div className="mt-4 space-y-3 rounded-xl border border-amber-300/20 bg-amber-500/10 p-3">
                  <div className="text-[11px] leading-5 text-amber-100/90">
                    Si el rechazo fue por monto, corrige primero el monto y despues sube el nuevo comprobante. Si el monto es correcto, no lo cambies y sube directamente el nuevo comprobante.
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[170px_1fr_auto]">
                    <input
                      value={correctedAmount}
                      onChange={(event) => setCorrectedAmount(event.target.value)}
                      disabled={amountBusy || busy || iqBusy}
                      inputMode="decimal"
                      placeholder="Monto corregido"
                      className="rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[12px] text-white outline-none disabled:opacity-60"
                    />
                    <input
                      value={amountReason}
                      onChange={(event) => setAmountReason(event.target.value)}
                      disabled={amountBusy || busy || iqBusy}
                      placeholder="Motivo de la correccion"
                      className="rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[12px] text-white outline-none disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={updateRejectedAmount}
                      disabled={amountBusy || busy || iqBusy || !amountReason.trim()}
                      className="rounded-xl border border-amber-300/30 bg-amber-500/20 px-3 py-2 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {amountBusy ? "Corrigiendo..." : "Corregir monto"}
                    </button>
                  </div>
                  <div className="text-[10px] text-amber-100/60">
                    Monto actual: ${formatMoney(currentPago?.montoTotal || 0)}. La correccion no desbloquea el pago; el desbloqueo ocurre al subir el nuevo comprobante.
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {canSyncIqPago ? (
            <div className="rounded-2xl border border-violet-400/25 bg-violet-500/10 p-4">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div>
                  <div className="text-sm font-semibold text-violet-100">
                    Revision IQ Pagos
                  </div>
                  <div className="mt-1 text-xs text-violet-200/70">
                    PAY0 determinara si debe crear, localizar o conciliar el deposito IQ sin duplicarlo.
                  </div>

                  {!hasActiveReceipt ? (
                    <div className="mt-2 text-[11px] text-amber-200">
                      Si aun no existe deposito IQ, sera necesario un comprobante activo para crearlo.
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={runIqPagoSync}
                    disabled={iqBusy || !pagoId || isTerminalLocked}
                    className="rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {iqBusy ? "Enviando..." : "Sincronizar IQ"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">
              Tipo documento
            </div>

            <UiSelect
              value={documentType}
              onChange={(value) => {
                if (!busy && !iqBusy) setDocumentType(value as PagoDocumentType);
              }}
              options={[
                { value: "COMPROBANTE_PAGO", label: "Comprobante de Pago" },
                { value: "OTRO", label: "Otro" },
              ]}
              placeholder="Tipo documento"
            />

            {documentType === "OTRO" && (
              <input
                value={otherLabel}
                onChange={(e) => setOtherLabel(e.target.value)}
                disabled={busy || iqBusy}
                placeholder="Nombre del documento"
                className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-[12px] text-slate-100 outline-none disabled:opacity-60"
              />
            )}
          </div>

          <div
            className={`rounded-2xl border border-dashed p-4 transition ${
              dragActive
                ? "border-sky-300 bg-sky-500/15 shadow-lg shadow-sky-950/20"
                : "border-sky-400/60 bg-[#0b1220]"
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!busy && !iqBusy) setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!busy && !iqBusy) setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragActive(false);
              if (busy || iqBusy) return;
              selectPagoDocFile(event.dataTransfer.files?.[0] || null);
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex cursor-pointer items-center gap-3 text-[12px] text-slate-200">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-sky-400/30 bg-sky-500/10 text-sky-300">
                  <UploadCloud size={15} />
                </span>
                <span>
                  <span className="block font-normal text-slate-100">
                    {file
                      ? fileLabel
                      : dragActive
                        ? "Suelta el archivo aqui"
                        : "Arrastra el archivo aqui o haz clic para seleccionar"}
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    Max 1MB. Si subes el mismo tipo, reemplaza la version activa anterior.
                  </span>
                </span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={accept}
                  disabled={busy || iqBusy}
                  onChange={(e) => selectPagoDocFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>

              <button
                type="button"
                onClick={onUpload}
                disabled={busy || iqBusy || !file}
                className="inline-flex items-center justify-center rounded-xl border border-sky-400/40 bg-sky-500/20 px-4 py-2 text-[11px] font-normal uppercase text-sky-100 transition hover:bg-sky-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                title={busy ? "Subiendo..." : "Subir documento"}
              >
                {busy ? `Subiendo ${pct || 0}%` : "Subir"}
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2">
              <div className="text-[10px] uppercase tracking-[0.12em] text-slate-300">
                Documentos cargados
              </div>
              <div className="text-[10px] text-slate-500">
                {visibleDocs.length} registros
              </div>
            </div>

            {visibleDocs.length === 0 ? (
              <div className="px-4 py-5 text-[12px] text-slate-400">
                Este pago todavia no tiene documentos.
              </div>
            ) : (
              <table className="w-full text-left">
                <thead className="text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-normal">Tipo</th>
                    <th className="px-4 py-2 text-center font-normal">Version</th>
                    <th className="px-4 py-2 text-center font-normal">Estatus</th>
                    <th className="px-4 py-2 font-normal">Fecha</th>
                    <th className="px-4 py-2 text-right font-normal">Acc.</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDocs.map((row) => (
                    <tr key={row.id} className="border-t border-white/5 text-[11px] text-slate-200">
                      <td className="px-4 py-3">
                        <div className="font-normal text-slate-100">
                          {row.documentTypeLabel || row.documentType || "Documento"}
                        </div>
                        <div className="mt-0.5 max-w-[220px] truncate text-[10px] text-slate-500">
                          {row.originalName || row.filename || row.id} - {formatSize(row.sizeBytes)}
                        </div>
                        {row.documentStateLabel ? (
                          <div className={`mt-1 text-[10px] ${
                            /^(REJECTED_IQ|CANCELLED_IQ)$/.test(String(row.status || "").toUpperCase())
                              ? "text-rose-300"
                              : "text-amber-300"
                          }`}>
                            {row.documentStateLabel}
                          </div>
                        ) : null}
                        {row.iqTerminalReason ? (
                          <div className="mt-0.5 max-w-[260px] truncate text-[9px] text-rose-200/60">
                            {row.iqTerminalReason}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-center font-mono">{row.version || "---"}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex h-5 min-w-[70px] items-center justify-center rounded-full border px-2 text-[9px] uppercase ${
                          /^(REJECTED_IQ|CANCELLED_IQ)$/.test(String(row.status || "").toUpperCase())
                            ? "border-rose-400/30 bg-rose-500/10 text-rose-300"
                            : row.active === false
                              ? "border-slate-500/20 bg-slate-500/10 text-slate-400"
                              : row.iqRetryForTerminalFolio
                                ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
                                : "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
                        }`}>
                          {String(row.status || "").toUpperCase() === "CANCELLED_IQ"
                            ? "CANCELADO"
                            : String(row.status || "").toUpperCase() === "REJECTED_IQ"
                              ? "RECHAZADO"
                            : row.active === false
                              ? "INACTIVO"
                              : row.iqRetryForTerminalFolio
                                ? "NUEVO"
                                : "ACTIVO"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{formatDate(row.finalizedAt || row.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openDoc(row)}
                            className="inline-flex items-center gap-1 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-[10px] font-normal uppercase text-sky-300 transition hover:bg-sky-500/20 hover:text-sky-100"
                            title="Descargar"
                            aria-label="Descargar"
                          >
                            <Download size={12} />
                            Descargar
                          </button>

                          {row.active !== false && (
                            <button
                              type="button"
                              onClick={() => deactivateDoc(row)}
                              disabled={busy || iqBusy}
                              className="rounded p-1 text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-100 disabled:opacity-50"
                              title="Desactivar"
                              aria-label="Desactivar"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
