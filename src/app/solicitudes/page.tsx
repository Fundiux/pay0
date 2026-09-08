"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { collection, query, where, onSnapshot, orderBy, doc, getDoc} from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole, isSuperAdmin, isAdmin, isOperador, mergeModules } from "@/lib/roles";
import { applyPagoToSolicitud, createPagoApplicationIdempotencyKey } from "@/services/pagos";
import { addSolicitudNota, cancelSolicitud, changeSolicitudStatus } from "@/services/solicitudes";
import { buildSustitucionSnapshot, buildSustitucionChain } from "@/lib/solicitudSustitucion";
import { normalizeSolicitudStatus } from "@/lib/solicitudStatus";
import { canApplyPagoFromPagos, canRejectSolicitudUI, needsCompletarSustitucion, canShowCancelSatAction, getDefaultCancelSatMotivo } from "@/lib/solicitudActionRules";
import {
  Plus,
  Trash2,
  Eye,
  MessageSquarePlus,
  Search,
  ChevronUp,
  ChevronDown,
  FileX,
  X,
  Ban,
  Send,
  Link2,
  FolderOpen
} from "lucide-react";
import NuevaSolicitudModal from "@/components/NuevaSolicitudModal";
import OrdenCompraMasivaModal from "@/components/OrdenCompraMasivaModal";
import DocsModal from "@/components/DocsModal";
import DateScopeBar from "@/components/DateScopeBar";
import { CustomRange, DateScopeMode, getScopeRange, isTsWithinRange, shiftBaseDate } from "@/lib/dateScope";
import UiSelect from "@/components/UiSelect";

function money2(value: any) {
  const raw = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const num = Number(raw || 0);
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

function toCurrency(value: any) {
  return money2(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function matchPagoWithSolicitud(p: any, s: any) {
  const byId =
    String(p?.clienteId || "").trim() &&
    String(s?.clienteId || "").trim() &&
    String(p?.clienteId || "").trim() === String(s?.clienteId || "").trim();

  const byName =
    String(p?.clienteNombre || "").trim().toLowerCase() &&
    String(s?.clienteNombre || "").trim().toLowerCase() &&
    String(p?.clienteNombre || "").trim().toLowerCase() === String(s?.clienteNombre || "").trim().toLowerCase();

  return !!byId || !!byName;
}

function noteDateTimeText(value: any) {
  if (value?.seconds) {
    return new Date(value.seconds * 1000).toLocaleString();
  }
  return "Ahora";
}

function NoteBubble({ note, myUid }: any) {
  const isMine = String(note?.createdBy || "") === String(myUid || "");
  const wrapper = isMine ? "justify-end" : "justify-start";
  const bubble = isMine
    ? "bg-sky-500/15 border-sky-500/20 text-slate-100"
    : "bg-white/5 border-white/10 text-slate-100";

  return (
    <div className={`flex ${wrapper}`}>
      <div className={`max-w-[80%] rounded-2xl border px-4 py-3 ${bubble}`}>
        <div className={`mb-1 text-[11px] ${isMine ? "text-sky-300 text-right" : "text-slate-400 text-left"}`}>
          {note?.createdByName || note?.createdByRole || "Sistema"}
        </div>
        <div className="whitespace-pre-wrap text-sm">{note?.text || "-"}</div>
        <div className={`mt-2 text-[10px] ${isMine ? "text-right text-sky-200/70" : "text-left text-slate-500"}`}>
          {noteDateTimeText(note?.createdAt)}
        </div>
      </div>
    </div>
  );
}

const SolicitudRow = React.memo(({
  s,
  onApplyPago,
  onDelete,
  onComment,
  onCancel,
  onReject,
  onCloseCancelSat,
  onSubmitCancelSat,
  onDocs,
  cancelSatFor,
  cancelSatMotivo,
  setCancelSatMotivo,
  cancelSatDetalle,
  setCancelSatDetalle,
  cancelSatUuidSustituto,
  setCancelSatUuidSustituto,
  cancelSatRelatedSolicitudId,
  setCancelSatRelatedSolicitudId,
  cancelSatSaving,
  canComment,
  canCancel,
  canUploadDocs,
  showIqFolio,
  allSolicitudes
}: any) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [children, setChildren] = useState<any[]>([]);
  const saldo = money2(Math.max(0, money2(s.monto || 0) - money2(s.totalAbonado || 0)));

  const statusUpper = String(s?.status || "").toUpperCase();
  const isCancelled = statusUpper === "CANCELADA" || statusUpper === "CANCELADO";
  const isTerminal = [
    "RECHAZADA",
    "RECHAZADO",
    "CANCELADA",
    "CANCELADO",
    "EN_SUSTITUCION",
    "ELIMINADA",
    "ELIMINADO"
  ].includes(statusUpper);
  const isHidden = !!s?.oculto;
  const targetFolio = String(s?.relatedSolicitudFolio || "").trim();
  const targetId = String(s?.relatedSolicitudId || "").trim();
  const uuidSustituto = String(s?.uuidCfdiSustituto || "").trim();
  const sustituyeFolio = String(s?._sustituyeFolio || "").trim();
  const sustitucionCompleta = statusUpper === "EN_SUSTITUCION" && (!!targetFolio || !!targetId) && !!uuidSustituto;
  const isIqCancellationPending = ["REQUESTED", "OUTCOME_UNKNOWN"].includes(String(s?.iqCancellationStatus || "").trim().toUpperCase());
  const displayStatus = isIqCancellationPending ? "PENDIENTE CANCELACIÃƒÆ’Ã¢â‚¬Å“N" : (sustitucionCompleta ? "SUSTITUIDA" : s.status);
  const canApplyFromPagos = canApplyPagoFromPagos(s);

  const sustitucionTrace = buildSustitucionSnapshot(s, allSolicitudes || []);
  const traceOrigenFolio = String(sustitucionTrace?.origen?.folio || "").trim();
  const traceActualFolio = String(s?.folio || s?.id || "").trim();
  const traceSustitutaFolio = String(sustitucionTrace?.sustituta?.folio || "").trim();
  const hasTrace = !!traceOrigenFolio || !!traceSustitutaFolio || statusUpper === "EN_SUSTITUCION";

  const sustitucionChain = buildSustitucionChain(s, allSolicitudes || []);
  const traceVigenteFolio = String(sustitucionChain?.vigente?.folio || sustitucionChain?.vigente?.id || "").trim();
  const traceChainText = Array.isArray(sustitucionChain?.chainFolios) ? sustitucionChain.chainFolios.join(" -> ") : "";
  const isCurrentVigente = sustitucionChain?.currentIndex >= 0 && sustitucionChain?.currentIndex === sustitucionChain?.vigenteIndex;

  const diasRestantes = useMemo(() => {
    if (saldo <= 0 || isTerminal) return null;
    const now = new Date();
    const limitDate = s.tipoFactura === "PPD"
      ? new Date(now.getFullYear(), 11, 31)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return Math.ceil((limitDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }, [saldo, s.tipoFactura, isCancelled]);

  const statusColors: any = {
    PROCESANDO: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    CONCILIACION_PENDIENTE: "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse",
    COMPLETADA: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    EN_SUSTITUCION: "bg-violet-500/10 text-violet-300 border-violet-500/20",
    CANCELADA: "bg-rose-500/10 text-rose-400 border-rose-500/20"
  };

  useEffect(() => {
    if (!isExpanded || !s.id) {
      setChildren([]);
      return;
    }

    const q = query(
      collection(db, "pagoAplicaciones"),
      where("solicitudId", "==", s.id),
    );

    return onSnapshot(q, (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as any))
        .sort(
          (a, b) =>
            Number(a?.createdAt?.seconds || 0) -
            Number(b?.createdAt?.seconds || 0),
        );

      setChildren(rows);
    });
  }, [isExpanded, s.id]);

  return (
    <>
      <tr className={`border-b border-white/5 transition-colors text-[11px] group font-normal text-white hover:bg-white/[0.02] ${isTerminal || isHidden ? "opacity-55" : ""}`}>
        <td className="pay0-td-date w-[78px] max-w-[78px] truncate whitespace-nowrap px-2 text-sky-400" title={String(s.folio || "")}>{s.folio}</td>
        {showIqFolio ? (
          <td className="pay0-td w-[76px] max-w-[76px] truncate whitespace-nowrap px-1 text-center font-mono text-violet-300" title={String(s.iqFolio || s.iqId || "")}>
            {s.iqFolio || s.iqId || "---"}
          </td>
        ) : null}
        <td className="pay0-td-date w-[92px] max-w-[92px] px-2">
          <div>
            {s.createdAt?.seconds ? new Date(s.createdAt.seconds * 1000).toLocaleDateString() : "---"}
          </div>
          {diasRestantes !== null && (
            <div className={`text-[9px] flex items-center gap-1 mt-0.5 ${diasRestantes <= 5 ? "text-rose-500 animate-pulse font-normal" : "text-slate-500"}`}>
{diasRestantes}d
            </div>
          )}
        </td>
        <td className="pay0-td truncate" title={String(s.clienteNombre || "")}>{s.clienteNombre}</td>
        <td className="pay0-td text-slate-500 truncate" title={String(s.empresaNombre || "")}>{s.empresaNombre}</td>
        <td className="pay0-td text-center text-slate-400">{s.tipoFactura}</td>
        <td className="pay0-td text-center text-sky-400 font-mono">{s.facturaDisplay || s.numFactura || s.facturaFolio || "S/F"}</td>
        <td className="pay0-td-money text-white text-center">
          ${toCurrency(s.monto || 0)}
        </td>
        <td className="pay0-td-money text-emerald-400 text-center">
          ${toCurrency(s.totalAbonado || 0)}
        </td>
        <td className="pay0-td-money text-amber-400 text-center">
          ${toCurrency(saldo || 0)}
        </td>
        <td className="pay0-td text-slate-500 italic text-center">
          {s.updatedAt?.seconds && saldo === 0 ? new Date(s.updatedAt.seconds * 1000).toLocaleDateString() : "---"}
        </td>
        <td className="pay0-td text-center">
          {canUploadDocs ? (
            <button
              title="Docs"
              onClick={() => onDocs(s)}
              className="text-sky-400 border border-dashed border-sky-400 rounded-full p-0.5 hover:bg-sky-400/10"
            >
              <Plus size={10} />
            </button>
          ) : (
            <span className="text-slate-600">-</span>
          )}
        </td>
        <td className="pay0-td text-center">
          {canComment ? (
            <button
              title="Bitacora"
              onClick={() => onComment(s)}
              className={`transition-all ${s.hasUnreadMsg ? "text-yellow-400 animate-[pulse_1.5s_infinite]" : "text-slate-500 hover:text-yellow-400"}`}
            >
              <MessageSquarePlus size={18} />
            </button>
          ) : (
            <span className="text-slate-600">-</span>
          )}
        </td>
        <td className="pay0-td text-center">
          <div className="flex flex-col items-center justify-center gap-1">
            <div className="flex items-center justify-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-[10px] uppercase border tracking-tighter min-w-[95px] h-6 inline-flex items-center justify-center ${
                  displayStatus === "SUSTITUIDA"
                    ? "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20"
                    : isIqCancellationPending ? "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse"
                    : (statusColors[s.status] || "bg-white/5")
                }`}
              >
                {displayStatus}
              </span>

              {isHidden && (
                <span className="rounded-full border border-slate-500/20 bg-slate-500/10 px-2 py-1 text-[9px] uppercase text-slate-400">
                  oculta
                </span>
              )}
            </div>

            {displayStatus === "SUSTITUIDA" && targetFolio && (
              <button
                onClick={() => {
                  const q = encodeURIComponent(String(targetFolio));
                  window.location.href = `/solicitudes?q=${q}`;
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-1 text-[9px] font-normal text-fuchsia-200 hover:bg-fuchsia-500/20"
                title="Abrir folio sustituto"
              >
                <Link2 size={12} />
                Sustituto: {targetFolio}
              </button>
            )}
          </div>
        </td>
        <td className="pay0-td min-w-[112px] text-right whitespace-nowrap">
          <div className="flex min-w-[188px] justify-end gap-2 opacity-100 transition-opacity">
            {canApplyFromPagos ? (
              <button
                title="Aplicar desde Pagos"
                aria-label="Aplicar desde Pagos"
                onClick={() => onApplyPago(s)}
                className="p-1 text-slate-500 transition-colors hover:text-emerald-400"
              >
                <Link2 size={16} />
              </button>
            ) : (
              <span className="p-1 text-slate-700">-</span>
            )}

            <button
              title="Mostrar"
              onClick={() => setIsExpanded(!isExpanded)}
              className={isExpanded ? "text-sky-400" : "text-slate-500 hover:text-white"}
            >
              <Eye size={16} />
            </button>



            {canCancel && canShowCancelSatAction(s) && (
              <>
                {canRejectSolicitudUI(s) && (
                  <button
                    title="Rechazar solicitud"
                    onClick={() => onReject(s)}
                    className="text-slate-500 hover:text-rose-500 p-1 transition-colors"
                  >
                    <FileX size={16} />
                  </button>
                )}

                <button
                  title="Cancelar"
                  onClick={() => onCancel(s)}
                  className="text-slate-500 hover:text-amber-500 p-1 transition-colors"
                >
                  <Ban size={16} />
                </button>
              </>
            )}

            {!isHidden && !isTerminal && (
              <button
                title="Eliminar"
                onClick={() => onDelete(s.id)}
                className="text-slate-500 hover:text-rose-500 p-1"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </td>
      </tr>

      {cancelSatFor?.id === s.id && (
        <tr className="border-b border-white/5 bg-amber-500/[0.04]">
          <td colSpan={showIqFolio ? 15 : 14} className="p-0">
            <div className="border-t border-white/5 bg-amber-500/[0.05] px-3 py-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1">
                  <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
                    Motivo SAT
                  </label>
                  <UiSelect
                    className="relative z-[60]"
                    size="compact"
                    menuMode="fixed"
                    value={cancelSatMotivo}
                    onChange={(value) => setCancelSatMotivo(value as any)}
                    disabled={!!cancelSatFor && (cancelSatFor?.status === "EN_SUSTITUCION" || money2(cancelSatFor?.totalAbonado || 0) > 0)}
                    options={[
                      { value: "01", label: "01 - Errores con relacion" },
                      { value: "02", label: "02 - Errores sin relacion" },
                      { value: "03", label: "03 - No se llevo a cabo la operacion" },
                      { value: "04", label: "04 - Operacion nominativa en factura global" },
                    ]}
                    placeholder="Motivo SAT"
                  />
                </div>

                <div className="min-w-[320px] flex-[1.6]">
                  <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
                    Detalle / observaciones
                  </label>
                  <input
                    value={cancelSatDetalle}
                    onChange={(e) => setCancelSatDetalle(e.target.value)}
                    placeholder="Detalle opcional de la cancelacion"
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white outline-none"
                  />
                </div>

                {cancelSatMotivo === "01" && (
                  <>
                    <div className="min-w-[280px] flex-[1.3]">
                      <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
                        UUID CFDI sustituto
                      </label>
                      <input
                        value={cancelSatUuidSustituto}
                        onChange={(e) => setCancelSatUuidSustituto(e.target.value)}
                        placeholder="UUID sustituto"
                        disabled={!!String(s?.uuidCfdiSustituto || "").trim()}
                        className={`w-full rounded-xl border px-3 py-2 text-[12px] text-white outline-none ${
                          String(s?.uuidCfdiSustituto || "").trim()
                            ? "border-violet-500/20 bg-violet-500/10 text-violet-200 opacity-90"
                            : "border-white/10 bg-black/30"
                        }`}
                      />
                    </div>

                    <div className="min-w-[240px] flex-1">
                      <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-400">
                        Solicitud relacionada
                      </label>
                      <input
                        value={cancelSatRelatedSolicitudId}
                        onChange={(e) => setCancelSatRelatedSolicitudId(e.target.value)}
                        placeholder="ID / folio relacionado"
                        disabled={!!String(s?.relatedSolicitudFolio || s?.relatedSolicitudId || "").trim()}
                        className={`w-full rounded-xl border px-3 py-2 text-[12px] text-white outline-none ${
                          String(s?.relatedSolicitudFolio || s?.relatedSolicitudId || "").trim()
                            ? "border-sky-500/20 bg-sky-500/10 text-sky-200 opacity-90"
                            : "border-white/10 bg-black/30"
                        }`}
                      />
                    </div>
                  </>
                )}

                <div className="ml-auto flex items-end gap-2">
                  <button
                    onClick={onCloseCancelSat}
                    className="rounded-xl border border-white/10 px-4 py-2 text-[12px] text-slate-300 hover:bg-white/5"
                  >
                    Cerrar
                  </button>

                  <button
                    onClick={onSubmitCancelSat}
                    disabled={cancelSatSaving}
                    className="rounded-xl bg-amber-500 px-4 py-2 text-[12px] font-normal text-black hover:bg-amber-400 disabled:opacity-60"
                  >
                    {cancelSatSaving ? "Guardando..." : (cancelSatFor?.status === "EN_SUSTITUCION" ? "Guardar datos de sustitucion" : "Confirmar cancelacion")}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
      {isExpanded && hasTrace && (
        <tr className="border-b border-violet-500/10 bg-violet-500/[0.025] text-[10px]">
          <td colSpan={showIqFolio ? 15 : 14} className="p-0">
            <div className="overflow-hidden">
              <table className="w-full text-left">
                <tbody>
                  <tr className="border-t border-violet-500/10 text-[9px] uppercase text-violet-300/70">
                    <td className="p-2 pl-8 font-normal">Evento</td>
                    <td className="p-2 font-normal">Fecha</td>
                    <td className="p-2 font-normal">Origen</td>
                    <td className="p-2 font-normal">Actual</td>
                    <td className="p-2 font-normal">Vigente / Sustituta</td>
                    <td className="p-2 font-normal">UUID sustituto</td>
                    <td className="p-2 font-normal">Estado</td>
                    <td className="p-2 text-center font-normal">AcciÃ³n</td>
                  </tr>

                  <tr className="border-t border-violet-500/10 bg-violet-500/[0.02] text-[11px]">
                    <td className="p-2 pl-8 font-normal text-violet-300">
                      SUSTITUCIÃ“N
                    </td>

                    <td className="p-2 text-slate-400">
                      {s?.sustitucionAt?.seconds
                        ? new Date(s.sustitucionAt.seconds * 1000).toLocaleString()
                        : "--"}
                    </td>

                    <td className="p-2 font-mono text-cyan-300">
                      {traceOrigenFolio || sustituyeFolio || "---"}
                    </td>

                    <td className="p-2 font-mono text-slate-200">
                      {traceActualFolio || "---"}
                    </td>

                    <td className="p-2 font-mono text-fuchsia-300">
                      {targetFolio || traceVigenteFolio || "---"}
                    </td>

                    <td className="p-2 font-mono text-slate-300">
                      {uuidSustituto || "---"}
                    </td>

                    <td className="p-2 text-violet-200">
                      {String(s?.sustitucionStatus || displayStatus || "EN_PROCESO")}
                    </td>

                    <td className="p-2 text-center">
                      {needsCompletarSustitucion(s) ? (
                        <button
                          onClick={() => onCancel(s)}
                          className="text-violet-300 uppercase font-normal text-[10px] hover:underline"
                          title="Agregar informacion faltante de sustitucion"
                        >
                          Completar datos
                        </button>
                      ) : (
                        <span className="text-slate-600">---</span>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}


      {isExpanded && (
        <tr className="bg-white/[0.01] border-b border-white/5 text-[10px] italic text-slate-500 animate-in slide-in-from-top-1">
          <td colSpan={showIqFolio ? 15 : 14} className="p-0">
            <div className="overflow-hidden">
              <table className="w-full text-left">
                <tbody>
                  {children.length > 0 ? (
                    <>
                      <tr className="border-t border-white/5 bg-white/[0.02] text-[9px] uppercase text-slate-500">
                        <td className="p-2 pl-8 font-normal">AplicaciÃƒÂ³n PAY0</td>
                        <td className="p-2 font-normal">Fecha</td>
                        <td className="p-2 text-center font-normal">Parcialidad</td>
                        <td className="p-2 text-center font-normal">Monto total</td>
                        <td className="p-2 text-center font-normal">Monto aplicado</td>
                        <td className="p-2 text-center font-normal">Saldo anterior</td>
                        <td className="p-2 text-center font-normal">Saldo insoluto</td>
                        <td className="p-2 text-center font-normal">Complemento</td>
                      </tr>

                      {children.map((c, i) => (
                        <tr key={i} className="border-t border-white/5 bg-sky-500/[0.01] text-[11px]">
                          <td className="p-2 pl-8 font-mono text-sky-300">
                            {c.folio || "---"}
                          </td>

                          <td className="p-2 text-slate-400">
                            {c.createdAt?.seconds ? new Date(c.createdAt.seconds * 1000).toLocaleString() : "--"}
                          </td>

                          <td className="p-2 text-center font-normal text-white">
                            {c.numeroParcialidad ?? "---"}
                          </td>

                          <td className="p-2 text-center text-slate-300">
                            {`$${toCurrency(c.montoTotal ?? s.monto ?? 0)}`}
                          </td>

                          <td className="p-2 text-center font-mono text-emerald-400">
                            ${toCurrency(c.montoAplicado || 0)}
                          </td>

                          <td className="p-2 text-center font-mono text-amber-300">
                            {c.saldoAnterior === undefined || c.saldoAnterior === null
                              ? "---"
                              : `$${toCurrency(c.saldoAnterior)}`}
                          </td>

                          <td className="p-2 text-center font-mono text-violet-300">
                            {c.saldoInsoluto === undefined || c.saldoInsoluto === null
                              ? "---"
                              : `$${toCurrency(c.saldoInsoluto)}`}
                          </td>

                          <td className="p-2 text-center">
                            {c.requiresComplement === true || c.invoiceType === "PPD" ? (
                              <span className="text-amber-300 uppercase text-[10px]">
                                Pendiente
                              </span>
                            ) : c.requiresComplement === false || c.invoiceType === "PUE" ? (
                              <span className="text-slate-500 uppercase text-[10px]">
                                No aplica
                              </span>
                            ) : (
                              <span className="text-slate-600">---</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </>
                  ) : (
                    <tr>
                      <td colSpan={8} className="p-3 pl-8 text-[9px] uppercase tracking-widest opacity-30">
                        Sin movimientos
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
});

export default function SolicitudesPage() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { profile } = useUserProfile();

  const [mode, setMode] = useState<DateScopeMode>("day");
  const [baseDate, setBaseDate] = useState(new Date());
  const [customRange, setCustomRange] = useState<CustomRange>({});
  const [viewMode, setViewMode] = useState<"active" | "all">("active");

  const [solicitudes, setSolicitudes] = useState<any[]>([]);

  // A54-A9 UPSERT LOCAL DE SOLICITUD RECIEN CREADA

  // Lee solo el documento creado y actualiza una fila; no refresca toda la tabla.

  useEffect(() => {

    const onSolicitudCreatedLocal = async (event: Event) => {

      const detail = (event as CustomEvent<{ solicitudId?: string; folio?: string }>).detail;

      const solicitudId = String(detail?.solicitudId || "").trim();

      if (!solicitudId) return;

  

      try {

        const snap = await getDoc(doc(db, "solicitudes", solicitudId));

        if (!snap.exists()) return;

  

        const incoming: any = { id: snap.id, ...snap.data() };

  

        setSolicitudes((prev: any[]) => {

          const index = prev.findIndex((item: any) => item?.id === incoming.id);

          if (index < 0) return [incoming, ...prev];

  

          const next = prev.slice();

          next[index] = { ...prev[index], ...incoming };

          return next;

        });

      } catch (error) {

        console.warn("[PAY0_SOLICITUD_LOCAL_UPSERT_ERROR]", error);

      }

    };

  

    window.addEventListener(

      "PAY0_SOLICITUD_CREATED_LOCAL",

      onSolicitudCreatedLocal

    );

  

    return () => {

      window.removeEventListener(

        "PAY0_SOLICITUD_CREATED_LOCAL",

        onSolicitudCreatedLocal

      );

    };

  }, []);

  const [pagos, setPagos] = useState<any[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const q = String(searchParams.get("q") || "").trim();
    if (q) {
      setFilter(q);
    }
  }, [searchParams]);
  const [sortConfig, setSortConfig] = useState({ key: "createdAt", dir: "desc" });
  const [applyPagoFor, setApplyPagoFor] = useState<any>(null);
  const applyRequestKeyRef = useRef("");
  const [selectedPagoId, setSelectedPagoId] = useState("");
  const [applyMonto, setApplyMonto] = useState("");
  const [applySaving, setApplySaving] = useState(false);

  const [docsFor, setDocsFor] = useState<any>(null);
  const [commentFor, setCommentFor] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [noteSending, setNoteSending] = useState(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [ordenCompraMassiveFiles, setOrdenCompraMassiveFiles] = useState<File[]>([]);
  const [isOrdenCompraPageDragging, setIsOrdenCompraPageDragging] = useState(false);

  useEffect(() => {
    if (!isNewModalOpen) return;
    // O26D safety clear OC page dragging
    setIsOrdenCompraPageDragging(false);
  }, [isNewModalOpen]);
  useEffect(() => {
    function hasFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types || []).includes("Files");
    }

    function isMassiveSolicitudFile(file: File) {
      const name = file.name.toLowerCase();
      return name.endsWith(".xls") || name.endsWith(".xlsx") || name.endsWith(".csv") || name.endsWith(".xml");
    }

    function handleWindowDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      if (isNewModalOpen || ordenCompraMassiveFiles.length > 0) return;

      event.preventDefault();
      setIsOrdenCompraPageDragging(true);
    }

    function handleWindowDragLeave(event: DragEvent) {
      if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) {
        setIsOrdenCompraPageDragging(false);
      }
    }

    function handleWindowDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      if (isNewModalOpen) return;

      event.preventDefault();
      setIsOrdenCompraPageDragging(false);

      const files = Array.from(event.dataTransfer?.files || []);
      const sourceFiles = files.filter(isMassiveSolicitudFile);

      if (sourceFiles.length === 0) {
        alert("Solo se permiten Ordenes de Compra Excel .xls, .xlsx, .csv o Facturas XML.");
        return;
      }

      setOrdenCompraMassiveFiles(sourceFiles);
    }

    // O26D window drop OC masiva
    window.addEventListener("dragover", handleWindowDragOver, true);
    window.addEventListener("dragleave", handleWindowDragLeave, true);
    window.addEventListener("drop", handleWindowDrop, true);

    return () => {
      window.removeEventListener("dragover", handleWindowDragOver, true);
      window.removeEventListener("dragleave", handleWindowDragLeave, true);
      window.removeEventListener("drop", handleWindowDrop, true);
    };
  }, [isNewModalOpen, ordenCompraMassiveFiles.length]);

  useEffect(() => {
    if (!isNewModalOpen) return;
    setIsOrdenCompraPageDragging(false);
  }, [isNewModalOpen]);
  function openNewSolicitudModalClean() {
    setIsOrdenCompraPageDragging(false);
    setOrdenCompraMassiveFiles([]);
    setIsNewModalOpen(true);
  }

  const [cancelSatFor, setCancelSatFor] = useState<any>(null);
  const [cancelSatMotivo, setCancelSatMotivo] = useState<"01" | "02" | "03" | "04">("02");
  const [cancelSatDetalle, setCancelSatDetalle] = useState("");
  const [cancelSatUuidSustituto, setCancelSatUuidSustituto] = useState("");
  const [cancelSatRelatedSolicitudId, setCancelSatRelatedSolicitudId] = useState("");
  const [cancelSatSaving, setCancelSatSaving] = useState(false);
  const [pageMsg, setPageMsg] = useState("");
  const [rejectFor, setRejectFor] = useState<any>(null);
  const [rejectMotivo, setRejectMotivo] = useState("monto no coincide");
  const [rejectDetalle, setRejectDetalle] = useState("");
  const [rejectSaving, setRejectSaving] = useState(false);

  const role = normalizeRole((profile as any)?.role);
  const rootId = (profile as any)?.rootId || user?.uid;
  const uid = user?.uid;

  const modules = useMemo(
    () => mergeModules((profile as any)?.role, (profile as any)?.modules),
    [profile]
  );

  const canViewSolicitudes = !!modules?.solicitudes?.view;
  const canCreateSolicitud = !!modules?.solicitudes?.create;
  const canCommentSolicitud = !!modules?.solicitudes?.comment;
  const canCancelSolicitud = !!modules?.solicitudes?.cancel;
  const canUploadDocsSolicitud = !!modules?.solicitudes?.uploadDocs;

  const range = useMemo(() => getScopeRange(mode, baseDate, customRange), [mode, baseDate, customRange]);

  useEffect(() => {
    if (!uid || !canViewSolicitudes) {
      setSolicitudes([]);
      return;
    }

    let qy;

    if (isSuperAdmin(role)) {
      if (!rootId) return;
      qy = query(
        collection(db, "solicitudes"),
        where("rootId", "==", rootId),
        orderBy("createdAt", "desc")
      );
    } else if (isAdmin(role)) {
      qy = query(
        collection(db, "solicitudes"),
        where("adminId", "==", uid),
        orderBy("createdAt", "desc")
      );
    } else if (isOperador(role)) {
      qy = query(
        collection(db, "solicitudes"),
        where("createdBy", "==", uid),
        orderBy("createdAt", "desc")
      );
    } else {
      return;
    }

    return onSnapshot(
      qy,
      (snap) => setSolicitudes(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => {
        setPageMsg("No se pudieron cargar solicitudes.");
        setSolicitudes([]);
      }
    );
  }, [uid, rootId, role, canViewSolicitudes]);

  useEffect(() => {
    if (!uid || !canViewSolicitudes) {
      setPagos([]);
      return;
    }

    if (isSuperAdmin(role)) {
      if (!rootId) {
        setPagos([]);
        return;
      }

      const qy = query(collection(db, "pagos"), where("rootId", "==", rootId));
      return onSnapshot(
        qy,
        (snap) => setPagos(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => {
          setPageMsg("No se pudieron cargar pagos.");
          setPagos([]);
        }
      );
    }

    if (isAdmin(role)) {
      const qy = query(collection(db, "pagos"), where("adminId", "==", uid));
      return onSnapshot(
        qy,
        (snap) => setPagos(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => {
          setPageMsg("No se pudieron cargar pagos.");
          setPagos([]);
        }
      );
    }

    if (isOperador(role)) {
      const qy = query(collection(db, "pagos"), where("createdBy", "==", uid));
      return onSnapshot(
        qy,
        (snap) => setPagos(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => {
          setPageMsg("No se pudieron cargar pagos.");
          setPagos([]);
        }
      );
    }

    setPagos([]);
  }, [uid, rootId, role, canViewSolicitudes]);

  useEffect(() => {
    if (commentFor) {
      const q = query(collection(db, `solicitudes/${commentFor.id}/notas`), orderBy("createdAt", "asc"));

      (async () => {
        try {
          await changeSolicitudStatus({ solicitudId: commentFor.id, hasUnreadMsg: false });
        } catch (e) {
          console.warn("changeSolicitudStatus(hasUnreadMsg:false) fallo", e);
        }
      })();

      return onSnapshot(
        q,
        (snap) => setMessages(snap.docs.map(d => d.data())),
        (err) => {
          setPageMsg("No se pudieron cargar notas.");
          setMessages([]);
        }
      );
    }
  }, [commentFor]);

  const filteredSortedData = useMemo(() => {
    const term = filter.toLowerCase();

    let data = solicitudes
      .filter(x => isTsWithinRange(x?.createdAt, range.from, range.to))
      .filter(x => {
        const status = String(x?.status || "").toUpperCase();
        const isCancelled = status === "CANCELADA" || status === "CANCELADO";
        const isTerminal = [
          "RECHAZADA",
          "RECHAZADO",
          "CANCELADA",
          "CANCELADO",
          "ELIMINADA",
          "ELIMINADO"
        ].includes(status);
        const isHidden = !!x?.oculto;

        if (viewMode === "active" && (isTerminal || isHidden)) return false;

        return ((x.folio || "").toLowerCase().includes(term) || (x.clienteNombre || "").toLowerCase().includes(term));
      });

    return data.sort((a, b) => {
      let vA: any = "";
      let vB: any = "";

      if (sortConfig.key === "pendiente") {
        vA = Math.max(0, Number(a?.monto || 0) - Number(a?.totalAbonado || 0));
        vB = Math.max(0, Number(b?.monto || 0) - Number(b?.totalAbonado || 0));
      } else {
        vA = a?.[sortConfig.key] ?? "";
        vB = b?.[sortConfig.key] ?? "";
      }

      if (vA?.seconds) vA = vA.seconds;
      if (vB?.seconds) vB = vB.seconds;

      if (vA < vB) return sortConfig.dir === "asc" ? -1 : 1;
      if (vA > vB) return sortConfig.dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [solicitudes, filter, sortConfig, range, viewMode]);

  const pagosDisponibles = useMemo(() => {
    if (!applyPagoFor) return [];

    return pagos
      .filter((p) => {
        const status = String(p?.status || "").toUpperCase();
        return status === "CONCILIADO" || status === "APLICADO_PARCIAL";
      })
      .filter((p) => money2(p?.montoDisponible || 0) > 0)
      .filter((p) => matchPagoWithSolicitud(p, applyPagoFor))
      .sort((a, b) => {
        const aSec = a?.createdAt?.seconds || 0;
        const bSec = b?.createdAt?.seconds || 0;
        return bSec - aSec;
      });
  }, [applyPagoFor, pagos]);

  const selectedPago = useMemo(() => {
    return pagosDisponibles.find((p) => p.id === selectedPagoId) || null;
  }, [pagosDisponibles, selectedPagoId]);

  const pendienteSolicitud = useMemo(() => {
    if (!applyPagoFor) return 0;
    return money2(Math.max(0, money2(applyPagoFor?.monto || 0) - money2(applyPagoFor?.totalAbonado || 0)));
  }, [applyPagoFor]);

  const handleRechazar = (sol: any) => {
    setPageMsg("");

    if (
      !canCancelSolicitud ||
      money2(sol?.totalAbonado || 0) > 0 ||
      String(sol?.status || "").toUpperCase() === "EN_SUSTITUCION"
    ) {
      return;
    }

    setRejectFor(sol);
    setRejectMotivo("monto no coincide");
    setRejectDetalle("");
  };

  const closeRejectModal = () => {
    if (rejectSaving) return;

    setRejectFor(null);
    setRejectMotivo("monto no coincide");
    setRejectDetalle("");
  };

  const submitRejectSolicitud = async () => {
    if (!rejectFor?.id || rejectSaving) return;

    setPageMsg("");

    const motivoLimpio = String(rejectMotivo || "").trim();
    const detalleLimpio = String(rejectDetalle || "").trim();

    if (!motivoLimpio) {
      setPageMsg("Debes capturar un motivo de rechazo.");
      return;
    }

    const rejectFn = changeSolicitudStatus;
    const noteFn = addSolicitudNota;

    try {
      setRejectSaving(true);

      await rejectFn({
        solicitudId: rejectFor.id,
        newStatus: "RECHAZADA",
        motivo: motivoLimpio,
        motivoRechazo: motivoLimpio,
        motivoRechazoDetalle: detalleLimpio || null,
      });

      const textoNota =
        `Solicitud rechazada. Motivo: ${motivoLimpio}` +
        (detalleLimpio ? ` | Detalle: ${detalleLimpio}` : "");

      await noteFn({
        solicitudId: rejectFor.id,
        text: textoNota,
      });

      setRejectFor(null);
      setRejectMotivo("monto no coincide");
      setRejectDetalle("");
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo rechazar la solicitud.");
    } finally {
      setRejectSaving(false);
    }
  };

  const handleCancel = async (sol: any) => {
    if (!canCancelSolicitud) return;
    setCancelSatFor(sol);
    setCancelSatMotivo(getDefaultCancelSatMotivo(sol));
    setCancelSatDetalle(String(sol?.motivoCancelacionDetalle || ""));
    setCancelSatUuidSustituto(String(sol?.uuidCfdiSustituto || ""));
    setCancelSatRelatedSolicitudId(String(sol?.relatedSolicitudFolio || sol?.relatedSolicitudId || ""));
  };

  const closeCancelSat = () => {
    setCancelSatFor(null);
    setCancelSatMotivo("02");
    setCancelSatDetalle("");
    setCancelSatUuidSustituto("");
    setCancelSatRelatedSolicitudId("");
    setCancelSatSaving(false);
  };

  const mergeSavedCancelSat = (saved: any) => {
    if (!saved?.solicitudId) return;

    setSolicitudes((prev: any[]) =>
      prev.map((item: any) =>
        item.id === saved.solicitudId ? { ...item, ...saved } : item
      )
    );

    setCancelSatFor((prev: any) =>
      prev?.id === saved.solicitudId ? { ...prev, ...saved } : prev
    );
  };

  const submitCancelSat = async () => {    setPageMsg("");
    if (!cancelSatFor) return;

    const cancelSatHasAbonos = money2(cancelSatFor?.totalAbonado || 0) > 0;

    if (cancelSatHasAbonos && cancelSatMotivo !== "01") {
      setPageMsg("Si la solicitud ya tiene abonos, solo puede cancelarse por sustitucion SAT 01.");
      return;
    }

    if (
      cancelSatMotivo === "01" &&
      !String(cancelSatUuidSustituto || "").trim() &&
      !String(cancelSatRelatedSolicitudId || "").trim()
    ) {
      setPageMsg("Para motivo SAT 01 captura UUID sustituto o solicitud relacionada.");
      return;
    }

    const cancelFn = cancelSolicitud;
    const statusFn = changeSolicitudStatus;
    let cancelResult: any = null;

    try {
      setCancelSatSaving(true);

      if (cancelSatMotivo === "01") {
        await statusFn({
          solicitudId: cancelSatFor.id,
          newStatus: "EN_SUSTITUCION",
          motivo: cancelSatDetalle?.trim() || `Sustitucion SAT ${cancelSatMotivo}`,
          motivoCancelacionSAT: cancelSatMotivo,
          motivoCancelacionDetalle: String(cancelSatDetalle || "").trim() || null,
          uuidCfdiSustituido: String(cancelSatFor?.uuid || "").trim() || null,
          uuidCfdiSustituto: String(cancelSatUuidSustituto || "").trim() || null,
          relatedSolicitudId: String(cancelSatRelatedSolicitudId || "").trim() || null,
        });
      } else {
        cancelResult = await cancelFn({
          solicitudId: cancelSatFor.id,
          motivo: cancelSatDetalle?.trim() || `Cancelacion SAT ${cancelSatMotivo}`,
          motivoCancelacionSAT: cancelSatMotivo,
          motivoCancelacionDetalle: String(cancelSatDetalle || "").trim() || null,
          uuidCfdiSustituto: String(cancelSatUuidSustituto || "").trim() || null,
          relatedSolicitudId: String(cancelSatRelatedSolicitudId || "").trim() || null,
        });
      }

      const nextUuid = String(
        cancelSatUuidSustituto || cancelSatFor?.uuidCfdiSustituto || ""
      ).trim() || null;

      const nextRelacion = String(
        cancelSatRelatedSolicitudId ||
        cancelSatFor?.relatedSolicitudFolio ||
        cancelSatFor?.relatedSolicitudId ||
        ""
      ).trim() || null;

      const cancelSatDetalleLimpio = String(cancelSatDetalle || "").trim();

      const satMotivoLabels: Record<string, string> = {
        "01": "Errores con relacion",
        "02": "Errores sin relacion",
        "03": "No se llevo a cabo la operacion",
        "04": "Operacion nominativa en factura global",
      };

      const satMotivoLabel = satMotivoLabels[String(cancelSatMotivo || "").trim()] || "Motivo no especificado";

      const noteText =
        cancelSatMotivo === "01"
          ? `Motivo de Sustitucion 01: ${satMotivoLabel}` +
            (cancelSatDetalleLimpio ? ` | ${cancelSatDetalleLimpio}` : "")
          : `Motivo de Cancelacion ${cancelSatMotivo}: ${satMotivoLabel}` +
            (cancelSatDetalleLimpio ? ` | ${cancelSatDetalleLimpio}` : "");

      try {
        await addSolicitudNota({
          solicitudId: cancelSatFor.id,
          text: noteText,
        });
      } catch (noteError) {
        console.warn("[Solicitudes] No se pudo guardar nota de cancelacion SAT", noteError);
      }

      if (cancelSatMotivo === "01") {
        const relacionLimpia = String(nextRelacion || "").trim();
        const folioOrigen = String(cancelSatFor?.folio || cancelSatFor?.id || "").trim();

        const solicitudSustituta = (solicitudes || []).find((x: any) =>
          String(x?.id || "").trim() === relacionLimpia ||
          String(x?.folio || "").trim() === relacionLimpia
        );

        if (solicitudSustituta?.id && folioOrigen) {
          try {
            await addSolicitudNota({
              solicitudId: solicitudSustituta.id,
              text: `Folio origen: ${folioOrigen}`,
            });
          } catch (mirrorNoteError) {
            console.warn("[Solicitudes] No se pudo guardar nota espejo en folio sustituto", mirrorNoteError);
          }
        }
      }

      const cancelResponse = (cancelResult as any)?.data || {};

      const savedPatch: any =
        cancelSatMotivo === "01"
          ? {
              status: "EN_SUSTITUCION",
              motivoCancelacionSAT: cancelSatMotivo,
              motivoCancelacionDetalle: String(
                cancelSatDetalle || cancelSatFor?.motivoCancelacionDetalle || ""
              ).trim() || null,
              uuidCfdiSustituto: nextUuid,
              relatedSolicitudFolio: cancelSatFor?.relatedSolicitudFolio || nextRelacion,
              relatedSolicitudId: cancelSatFor?.relatedSolicitudId || null,
              sustitucionStatus: cancelSatFor?.sustitucionStatus || "EN_PROCESO",
            }
          : {
              status: String(cancelResponse?.status || cancelSatFor?.status || "PROCESANDO"),
              motivoCancelacionSAT: cancelSatMotivo,
              motivoCancelacionDetalle: String(cancelSatDetalle || "").trim() || null,
              uuidCfdiSustituto: nextUuid,
              relatedSolicitudFolio: cancelSatFor?.relatedSolicitudFolio || nextRelacion,
              relatedSolicitudId: cancelSatFor?.relatedSolicitudId || null,
            };

      setSolicitudes((prev: any[]) =>
        prev.map((item: any) =>
          item.id === cancelSatFor.id ? { ...item, ...savedPatch } : item
        )
      );

      closeCancelSat();
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo actualizar la solicitud.");
    } finally {
      setCancelSatSaving(false);
    }
  };

  const handleHide = async (id: string) => {
    try {
      await changeSolicitudStatus({ solicitudId: id, ocultar: true });
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo completar la accion.");
    }
  };

  const sendNote = async () => {    setPageMsg("");
    if (noteSending) return;
    if (!canCommentSolicitud) return;

    const text = newMsg.trim();
    if (!text || !commentFor) return;

    setNoteSending(true);

    try {
      await addSolicitudNota({ solicitudId: commentFor.id, text });
      setNewMsg("");
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo completar la accion.");
    } finally {
      setNoteSending(false);
    }
  };

  const openApplyPagoModal = (sol: any) => {
    applyRequestKeyRef.current = createPagoApplicationIdempotencyKey();
    setApplyPagoFor(sol);
    setSelectedPagoId("");
    setApplyMonto("");
  };

  const applyFromPago = async () => {    setPageMsg("");
    if (!applyPagoFor?.id) return;
    if (!selectedPago) {
      setPageMsg("Selecciona un pago disponible.");
      return;
    }

    const monto = money2(applyMonto || 0);
    if (!Number.isFinite(monto) || monto <= 0) {
      setPageMsg("Monto invalido.");
      return;
    }

    const disponible = money2(selectedPago?.montoDisponible || 0);
    if (monto > disponible) {
      setPageMsg("El monto excede el disponible del pago seleccionado.");
      return;
    }

    if (monto > pendienteSolicitud) {
      setPageMsg("El monto excede el pendiente de la solicitud.");
      return;
    }

    try {
      setApplySaving(true);

      const idempotencyKey =
        applyRequestKeyRef.current || createPagoApplicationIdempotencyKey();
      applyRequestKeyRef.current = idempotencyKey;

      await applyPagoToSolicitud({
        pagoId: selectedPago.id,
        solicitudId: applyPagoFor.id,
        montoAplicado: monto,
        idempotencyKey,
      });

      applyRequestKeyRef.current = "";
      setApplyPagoFor(null);
      setSelectedPagoId("");
      setApplyMonto("");
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo aplicar el pago.");
    } finally {
      setApplySaving(false);
    }
  };

  if (!canViewSolicitudes) {
    return (
      <div className="w-[98%] mx-auto py-10 text-slate-400">
        No tienes acceso a Solicitudes.
      </div>
    );
  }

  return (
    <div
      className="relative w-full min-w-0 py-4 text-white font-normal"
      onDragEnter={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (isNewModalOpen || ordenCompraMassiveFiles.length > 0) return;
        setIsOrdenCompraPageDragging(true);
      }}
      onDragOver={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (isNewModalOpen || ordenCompraMassiveFiles.length > 0) return;
        setIsOrdenCompraPageDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.defaultPrevented) return;
        const nextTarget = e.relatedTarget as Node | null;
        if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
          setIsOrdenCompraPageDragging(false);
        }
      }}
      onDrop={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        setIsOrdenCompraPageDragging(false);

        if (isNewModalOpen) return;

        const files = Array.from(e.dataTransfer.files || []);
        const sourceFiles = files.filter((file) => {
          const name = file.name.toLowerCase();
          return name.endsWith(".xls") || name.endsWith(".xlsx") || name.endsWith(".csv") || name.endsWith(".xml");
        });

        if (sourceFiles.length === 0) {
          alert("Solo se permiten Ordenes de Compra Excel .xls, .xlsx, .csv o Facturas XML.");
          return;
        }

        setOrdenCompraMassiveFiles(sourceFiles);
      }}
    >
      {isOrdenCompraPageDragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-2 border-dashed border-[#0063C4]/60 bg-[#0063C4]/10 p-6">
          <div className="rounded-2xl border border-[#0063C4]/50 bg-[#0b1220]/95 px-6 py-5 text-center shadow-2xl shadow-black/40">
            <div className="text-[14px] font-normal text-white">Suelta Ordenes de Compra o Facturas XML aqui</div>
            <div className="mt-1 text-[12px] text-slate-400">Varios XML, varios Excel o un Excel con varias pestanas</div>
          </div>
        </div>
      ) : null}
      <header className="mb-2 grid min-w-0 grid-cols-1 gap-1.5 2xl:grid-cols-[380px_minmax(0,1fr)_auto] 2xl:items-center">
        <div className="relative w-full min-w-0 2xl:w-[380px]">
          <Search className="absolute left-3 top-2.5 text-slate-500" size={14} />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Buscar por folio o cliente..."
            className="h-9 w-full rounded-xl border border-white/10 bg-[#161d2b] py-2 pl-9 text-[11px] outline-none"
          />
        </div>

        <DateScopeBar
          className="min-w-0 w-full 2xl:flex-1"
          mode={mode}
          baseDate={baseDate}
          customRange={customRange}
          onModeChange={(m) => {
            setMode(m);
            if (m !== "custom") {
              setCustomRange({});
              setBaseDate(new Date());
            }
          }}
          onNavigate={(direction) => setBaseDate((prev) => shiftBaseDate(mode, prev, direction))}
          onCustomRangeChange={(rangeValue) => {
            setCustomRange(rangeValue);
            if (rangeValue.start && rangeValue.end) {
              setMode("custom");
            }
          }}
        />

        <div className="flex w-full min-w-0 flex-wrap items-center gap-1.5 2xl:w-auto 2xl:shrink-0">
          <button
            onClick={() => setViewMode("active")}
            className={viewMode === "active"
              ? "h-9 flex-1 rounded-xl border border-sky-400 bg-sky-400/10 px-3 text-[11px] font-normal text-sky-300 sm:flex-none"
              : "h-9 flex-1 rounded-xl border border-white/10 px-3 text-[11px] font-normal text-slate-400 hover:bg-white/5 sm:flex-none"}
          >
            ACTIVAS
          </button>

          <button
            onClick={() => setViewMode("all")}
            className={viewMode === "all"
              ? "h-9 flex-1 rounded-xl border border-sky-400 bg-sky-400/10 px-3 text-[11px] font-normal text-sky-300 sm:flex-none"
              : "h-9 flex-1 rounded-xl border border-white/10 px-3 text-[11px] font-normal text-slate-400 hover:bg-white/5 sm:flex-none"}
          >
            VER TODAS
          </button>

          {canCreateSolicitud && (
            <button
              onClick={openNewSolicitudModalClean}
              className="h-9 flex-1 rounded-xl bg-sky-500 px-3 text-[11px] font-normal text-black hover:bg-sky-400 sm:flex-none"
            >
              + Nueva Solicitud
            </button>
          )}
        </div>
      </header>

      {pageMsg && (
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          {pageMsg}
        </div>
      )}
      <div className="w-full min-w-0 rounded-2xl border border-white/5 bg-[#161d2b] shadow-2xl overflow-x-auto">
        <table className={`pay0-solicitudes-main-table pay0-table w-full text-left ${isSuperAdmin(role) ? "min-w-[1450px] xl:min-w-[1450px]" : "min-w-[1120px] xl:min-w-[1260px]"}`}>
          <colgroup className="pay0-solicitudes-colgroup">
            <col className="pay0-sol-col-folio" style={{ width: "78px" }} />
            {isSuperAdmin(role) ? <col className="pay0-sol-col-folio-iq" style={{ width: "76px" }} /> : null}
            <col className="pay0-sol-col-fecha" style={{ width: "92px" }} />
            <col className="pay0-sol-col-cliente" style={{ width: "210px" }} />
            <col className="pay0-sol-col-empresa" style={{ width: "190px" }} />
            <col className="pay0-sol-col-metodo" style={{ width: "64px" }} />
            <col className="pay0-sol-col-factura" style={{ width: "70px" }} />
            <col className="pay0-sol-col-monto" style={{ width: "100px" }} />
            <col className="pay0-sol-col-abono" style={{ width: "92px" }} />
            <col className="pay0-sol-col-pendiente" style={{ width: "105px" }} />
            <col className="pay0-sol-col-fecha-pago" style={{ width: "72px" }} />
            <col className="pay0-sol-col-docs" style={{ width: "42px" }} />
            <col className="pay0-sol-col-nota" style={{ width: "42px" }} />
            <col className="pay0-sol-col-estatus" style={{ width: "108px" }} />
            <col className="pay0-sol-col-acciones" style={{ width: "112px" }} />
          </colgroup>
          <thead className="uppercase">
            <tr className="text-slate-500">
              <th
                className="w-[78px] max-w-[78px] cursor-pointer px-2 hover:text-sky-400 !text-[13px] !py-[6px] font-normal"
                onClick={() => setSortConfig((prev) => ({
                  key: "folio",
                  dir: prev.key === "folio" && prev.dir === "asc" ? "desc" : "asc"
                }))}
              >
                <div className="flex items-center gap-1">
                  Folio
                  {sortConfig.key === "folio" && (sortConfig.dir === "asc" ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                </div>
              </th>
              {isSuperAdmin(role) ? (
                <th className="pay0-th w-[76px] max-w-[76px] px-1 text-center !text-[12px] !py-[6px] font-normal">
                  Folio IQ
                </th>
              ) : null}
              {[
                { label:"Fecha", key:"createdAt" },
                { label:"Cliente", key:"clienteNombre" },
                { label:"Empresa", key:"empresaNombre" },
                { label:"Metodo", key:"tipoFactura" },
                { label:"Factura", key:"facturaDisplay" },
                { label:"Monto", key:"monto" },
                { label:"Abono", key:"totalAbonado" },
                { label:"Pendiente", key:"pendiente" },
                { label:"Pago", key:"updatedAt" }
              ].map(h => (
                <th
                  key={h.key}
                  className={`p-3 cursor-pointer hover:text-sky-400 !text-[13px] ${["Monto", "Abono", "Pendiente", "Pago"].includes(h.label) ? "text-center" : ""} !py-[6px] font-normal`}
                  onClick={() => setSortConfig((prev) => ({
                    key: h.key,
                    dir: prev.key === h.key && prev.dir === "asc" ? "desc" : "asc"
                  }))}
                >
                  <div className={`flex items-center gap-1 ${["Monto", "Abono", "Pendiente", "Pago"].includes(h.label) ? "justify-center" : ""}`}>
                    {h.label}
                    {sortConfig.key === h.key && (sortConfig.dir === "asc" ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                  </div>
                </th>
              ))}
              <th className="pay0-th text-center !text-[13px] !py-[6px] font-normal">Docs</th>
              <th className="pay0-th text-center !text-[13px] !py-[6px] font-normal">Nota</th>
              <th className="pay0-th text-center !text-[13px] !py-[6px] font-normal">Estatus</th>
              <th className="pay0-th min-w-[112px] text-center !text-[13px] !py-[6px] font-normal">Acc.</th>
            </tr>
          </thead>
          <tbody className="[&>tr:nth-child(odd)]:bg-white/[0.025] [&>tr:nth-child(even)]:bg-slate-950/20">
            {filteredSortedData.length === 0 ? (
              <tr>
                <td colSpan={isSuperAdmin(role) ? 15 : 14} className="p-4 text-[12px] italic text-slate-500">
                  no hay registros para este periodo
                </td>
              </tr>
            ) : (
              filteredSortedData.map((s, index) => (
                <SolicitudRow
                  key={s.id}
                  s={{
                    ...s,
                    _sustituyeFolio:
                      filteredSortedData.find((x: any) =>
                        String(x?.status || "").toUpperCase() === "EN_SUSTITUCION" &&
                        (
                          (String(x?.relatedSolicitudFolio || "").trim() !== "" &&
                            String(x?.relatedSolicitudFolio || "").trim() === String(s?.folio || "").trim()) ||
                          (String(x?.relatedSolicitudId || "").trim() !== "" &&
                            String(x?.relatedSolicitudId || "").trim() === String(s?.id || "").trim())
                        )
                      )?.folio || null
                  }}
                  onApplyPago={openApplyPagoModal}
                  onComment={setCommentFor}
                  onCancel={handleCancel}
                  onReject={handleRechazar}
                  onCloseCancelSat={closeCancelSat}
                  onSubmitCancelSat={submitCancelSat}
                  cancelSatFor={cancelSatFor}
                  cancelSatMotivo={cancelSatMotivo}
                  setCancelSatMotivo={setCancelSatMotivo}
                  cancelSatDetalle={cancelSatDetalle}
                  setCancelSatDetalle={setCancelSatDetalle}
                  cancelSatUuidSustituto={cancelSatUuidSustituto}
                  setCancelSatUuidSustituto={setCancelSatUuidSustituto}
                  cancelSatRelatedSolicitudId={cancelSatRelatedSolicitudId}
                  setCancelSatRelatedSolicitudId={setCancelSatRelatedSolicitudId}
                  cancelSatSaving={cancelSatSaving}
                  onDocs={setDocsFor}
                  onDelete={handleHide}
                  canComment={canCommentSolicitud}
                  canCancel={canCancelSolicitud}
                  canUploadDocs={canUploadDocsSolicitud}
                  showIqFolio={isSuperAdmin(role)}
                  allSolicitudes={filteredSortedData}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <NuevaSolicitudModal open={isNewModalOpen} onClose={() => setIsNewModalOpen(false)} />

      <OrdenCompraMasivaModal
        open={ordenCompraMassiveFiles.length > 0}
        files={ordenCompraMassiveFiles}
        onClose={() => {
          setIsOrdenCompraPageDragging(false);
          setOrdenCompraMassiveFiles([]);
        }}
        onFilesConsumed={() => setIsOrdenCompraPageDragging(false)}
      />

      {rejectFor && (
        <div
          className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeRejectModal();
            }
          }}
        >
          <div
            className="relative w-full max-w-[430px] overflow-visible rounded-3xl border border-white/10 bg-[#161d2b] p-6 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeRejectModal}
              disabled={rejectSaving}
              className="absolute -right-2 -top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400 shadow-lg shadow-black/40 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
              aria-label="Cerrar"
              title="Cerrar"
            >
              <X size={16} strokeWidth={1.9} />
            </button>

            <div className="space-y-3">
              <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white">
                <div className="truncate font-normal">{rejectFor?.folio || rejectFor?.id || "Solicitud"}</div>
                <div className="mt-1 text-xs text-slate-400">{rejectFor?.clienteNombre || "---"}</div>
              </div>

              <UiSelect
                value={rejectMotivo}
                onChange={setRejectMotivo}
                disabled={rejectSaving}
                options={[
                  { value: "cliente no coincide", label: "cliente no coincide" },
                  { value: "empresa emisora no coincide", label: "empresa emisora no coincide" },
                  { value: "monto no coincide", label: "monto no coincide" },
                  { value: "documento invalido", label: "documento invalido" },
                  { value: "otro", label: "otro" },
                ]}
                placeholder="Motivo de rechazo"
              />

              <textarea
                value={rejectDetalle}
                onChange={(event) => setRejectDetalle(event.target.value)}
                disabled={rejectSaving}
                rows={3}
                placeholder="Detalle adicional del rechazo (opcional)"
                className="w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white outline-none transition placeholder:text-slate-500 hover:bg-white/5 focus:border-sky-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              />

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeRejectModal}
                  disabled={rejectSaving}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs font-normal uppercase text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={submitRejectSolicitud}
                  disabled={rejectSaving || !String(rejectMotivo || "").trim()}
                  className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-xs font-normal uppercase text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rejectSaving ? "Rechazando..." : "Rechazar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {commentFor && (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-3xl border border-white/10 bg-[#161d2b] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <div>
                <div className="text-sm font-normal text-white">Bitacora / Notas</div>
                <div className="text-[11px] text-slate-400">
                  {commentFor?.folio}  {commentFor?.clienteNombre || "---"}
                </div>
              </div>

              <button
                onClick={() => {
                  setCommentFor(null);
                  setMessages([]);
                  setNewMsg("");
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <div className="text-sm text-slate-400">Sin mensajes todavia.</div>
              ) : (
                messages.map((note, i) => (
                  <NoteBubble
                    key={note?.id || i}
                    note={note}
                    myUid={uid}
                  />
                ))
              )}
            </div>

            <div className="border-t border-white/10 p-4">
              <div className="flex gap-2">
                <input
                  value={newMsg}
                  onChange={(e) => setNewMsg(e.target.value)}
                  placeholder={noteSending ? "Enviando nota..." : "Escribe una nota..."}
                  disabled={noteSending}
                  className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[12px] outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!noteSending) sendNote();
                    }
                  }}
                />
                <button
                  onClick={sendNote}
                  disabled={noteSending || !newMsg.trim()}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-[12px] font-normal text-black hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  title={noteSending ? "Enviando..." : "Enviar nota"}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {applyPagoFor && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl rounded-3xl border border-white/10 bg-[#161d2b] p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-normal text-white">Aplicar desde Pagos</div>
                <div className="text-[11px] text-slate-400">{applyPagoFor?.folio}  {applyPagoFor?.clienteNombre || "---"}</div>
              </div>
              <button
                onClick={() => {
                  applyRequestKeyRef.current = "";
                  setApplyPagoFor(null);
                  setSelectedPagoId("");
                  setApplyMonto("");
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-4 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-[11px] text-slate-400">Solicitud</div>
                <div className="mt-1 font-mono text-sky-400">{applyPagoFor?.folio || "---"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-[11px] text-slate-400">Pendiente</div>
                <div className="mt-1 font-normal text-amber-300">${toCurrency(pendienteSolicitud)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-[11px] text-slate-400">Cliente</div>
                <div className="mt-1 text-white">{applyPagoFor?.clienteNombre || "---"}</div>
              </div>
            </div>

            {pagosDisponibles.length === 0 ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-300">
                No hay pagos conciliados o parcialmente aplicados con saldo disponible para este cliente.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto rounded-2xl border border-white/10">
                  <table className="w-full min-w-[900px] text-left">
                    <thead className="border-b border-white/10 bg-white/5 text-[9px] uppercase text-slate-500">
                      <tr>
                        <th className="pay0-th">Pago</th>
                        <th className="pay0-th">Fecha</th>
                        <th className="pay0-th">Estatus</th>
                        <th className="pay0-th text-center">Disponible</th>
                        <th className="pay0-th text-center">Seleccionar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagosDisponibles.map((p) => (
                        <tr
                          key={p.id}
                          className={`border-b border-white/5 text-[11px] ${selectedPagoId === p.id ? "bg-sky-500/10" : "hover:bg-white/[0.02]"}`}
                        >
                          <td className="pay0-td font-mono text-sky-400">{p.id}</td>
                          <td className="pay0-td text-slate-300">
                            {p?.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleString() : "---"}
                          </td>
                          <td className="pay0-td">
                            <span className="inline-flex rounded-full border border-white/10 px-3 py-1 text-[10px] text-slate-200">
                              {p?.status || "---"}
                            </span>
                          </td>
                          <td className="pay0-td text-center font-mono text-emerald-300">
                            ${toCurrency(p?.montoDisponible || 0)}
                          </td>
                          <td className="pay0-td text-center">
                            <button
                              onClick={() => {
                                setSelectedPagoId(p.id);
                                const maxAplicable = Math.min(
                                  money2(p?.montoDisponible || 0),
                                  money2(pendienteSolicitud)
                                );
                                setApplyMonto(String(maxAplicable));
                              }}
                              className={selectedPagoId === p.id
                                ? "rounded-xl bg-sky-500 px-3 py-2 text-[11px] font-normal text-black"
                                : "rounded-xl border border-white/10 px-3 py-2 text-[11px] text-slate-300 hover:bg-white/5"}
                            >
                              {selectedPagoId === p.id ? "Seleccionado" : "Usar este pago"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 rounded-xl border border-sky-500/20 bg-sky-500/10 p-3 text-[11px] text-slate-200">
                    Para operaciones <span className="font-normal text-sky-300">PPD</span>, el sistema genera automaticamente:
                    <span className="ml-1 font-normal text-white">parcialidad, saldo anterior, saldo insoluto y referencia de aplicacion.</span>
                  </div>
                  <div className="mb-2 text-[12px] text-slate-300">Monto a aplicar</div>
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <input
                      value={applyMonto}
                      onChange={(e) => setApplyMonto(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-slate-100 outline-none md:max-w-xs"
                    />

                    <button
                      onClick={() => {
                        if (!selectedPago) return;
                        const maxAplicable = Math.min(
                          money2(selectedPago?.montoDisponible || 0),
                          money2(pendienteSolicitud)
                        );
                        setApplyMonto(String(maxAplicable));
                      }}
                      className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 text-[12px] font-normal text-sky-300 hover:bg-sky-500/20"
                    >
                      Aplicar maximo
                    </button>

                    <div className="text-[12px] text-slate-400">
                      {selectedPago ? (
                        <>Disponible del pago seleccionado: <span className="font-normal text-white">${toCurrency(selectedPago?.montoDisponible || 0)}</span></>
                      ) : (
                        <>Selecciona un pago para continuar.</>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    onClick={() => {
                      applyRequestKeyRef.current = "";
                      setApplyPagoFor(null);
                      setSelectedPagoId("");
                      setApplyMonto("");
                    }}
                    className="rounded-xl border border-white/10 px-4 py-3 text-[12px] text-slate-300 hover:bg-white/5"
                  >
                    Cerrar
                  </button>

                  <button
                    onClick={applyFromPago}
                    disabled={applySaving || !selectedPagoId}
                    className="rounded-xl bg-emerald-500 px-5 py-3 text-[12px] font-normal text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {applySaving ? "Aplicando..." : "Aplicar pago"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <DocsModal open={!!docsFor} solicitud={docsFor} onClose={() => setDocsFor(null)} />
    </div>
  );
}