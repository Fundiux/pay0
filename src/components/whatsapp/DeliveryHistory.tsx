"use client";

import { useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { getWhatsAppQrDashboard, resolveWhatsAppUncertainDelivery, type WhatsAppQrJob } from "@/services/whatsappQr";

const MAX_ROWS = 300;

const clean = (value: unknown) => String(value || "").trim();
const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function formatDate(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

const status = (job: WhatsAppQrJob) => clean(job.status).toUpperCase();
const isSent = (job: WhatsAppQrJob) => status(job) === "SENT" || (!!job.deliveryStatsUi && job.deliveryStatsUi.total > 0 && job.deliveryStatsUi.sent === job.deliveryStatsUi.total);
const isBlocked = (job: WhatsAppQrJob) => status(job) === "BLOCKED_UNCERTAIN" || Number(job.deliveryStatsUi?.blocked || 0) > 0;
const isError = (job: WhatsAppQrJob) => ["ERROR", "ERROR_PARTIAL", "ERROR_RETRYABLE"].includes(status(job)) || Number(job.deliveryStatsUi?.error || 0) > 0;

function statusLabel(job: WhatsAppQrJob) {
  if (isBlocked(job)) return "Sin confirmar";
  if (isSent(job)) return "Enviado";
  if (isError(job)) return "Error";
  const value = status(job);
  if (value === "READY_FOR_MANUAL_SEND") return "Pendiente";
  if (value === "READY_FOR_SEND") return "En cola";
  if (value === "SENDING") return "Enviando";
  if (["OMITTED", "OMITTED_BACKLOG_RESET"].includes(value)) return "Omitido";
  if (value === "CANCELLED") return "Cancelado";
  return "Pendiente";
}

function statusClass(job: WhatsAppQrJob) {
  if (isBlocked(job)) return "border-orange-500/30 bg-orange-500/10 text-orange-200";
  if (isSent(job)) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
  if (isError(job)) return "border-rose-500/30 bg-rose-500/10 text-rose-200";
  if (["READY_FOR_SEND", "SENDING"].includes(status(job))) return "border-sky-500/30 bg-sky-500/10 text-sky-200";
  return "border-amber-500/30 bg-amber-500/10 text-amber-200";
}

const clientOf = (job: WhatsAppQrJob) => clean(job.targetLabel) || "Sin cliente";
const destinationOf = (job: WhatsAppQrJob) => clean(job.targetChatName) || clean(job.targetDestinations?.[0]?.chatName) || "-";
const dateOf = (job: WhatsAppQrJob) => job.createdAt || job.updatedAt;

// Historial de envíos de documentos a clientes. Los envíos sin confirmar (Hugo envió pero no se supo
// si llegó) solo se resuelven aquí, por una persona: nunca se reenvían solos.
export function DeliveryHistory() {
  const [jobs, setJobs] = useState<WhatsAppQrJob[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [resolvingId, setResolvingId] = useState("");
  const [notice, setNotice] = useState("");

  async function resolve(job: WhatsAppQrJob, decision: "CONFIRM_SENT" | "ALLOW_RESEND") {
    const question = decision === "CONFIRM_SENT"
      ? "Confirma que el cliente sí recibió este documento en WhatsApp."
      : "Hugo volverá a enviar este documento. Úsalo solo si verificaste que no llegó.";
    if (!window.confirm(question)) return;
    setResolvingId(job.id);
    setNotice("");
    try {
      const result = await resolveWhatsAppUncertainDelivery({ jobId: job.id, decision });
      setNotice(result.message);
      await load();
    } catch (e: any) {
      setNotice(`No se pudo resolver: ${e?.message || e}`);
    } finally {
      setResolvingId("");
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      setJobs((await getWhatsAppQrDashboard()).jobs || []);
    } catch (e: any) {
      setError(`No se pudo cargar el historial: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => {
    const query = norm(search.trim());
    return [...(jobs || [])]
      .sort((a, b) => new Date(String(dateOf(b) || 0)).getTime() - new Date(String(dateOf(a) || 0)).getTime())
      .filter(job => !query || norm(`${clientOf(job)} ${destinationOf(job)}`).includes(query));
  }, [jobs, search]);

  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.03]" onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open && jobs === null && !loading) void load(); }}>
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-white/[0.02]">
        Historial de envíos de documentos{jobs ? ` (${jobs.length})` : ""}
      </summary>
      <div className="space-y-3 border-t border-white/10 p-4">
        <p className="text-xs text-slate-500">Documentos enviados a clientes por WhatsApp. Un envío sin confirmar no se repite solo: revisa el chat y decide.</p>
        {notice && <p className="text-sm text-slate-300">{notice}</p>}
        {loading && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</div>}
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {jobs && (
          <>
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente o destino" aria-label="Buscar en el historial" className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none focus:border-sky-400/40" />
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-slate-500">No hay envíos que mostrar.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-slate-400">
                    <tr><th className="p-2">Fecha</th><th className="p-2">Cliente</th><th className="p-2">Destino</th><th className="p-2 text-right">Documentos</th><th className="p-2">Estado</th><th className="p-2"></th></tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, MAX_ROWS).map(job => (
                      <tr key={job.id} className="border-b border-white/5">
                        <td className="whitespace-nowrap p-2 text-slate-300">{formatDate(dateOf(job))}</td>
                        <td className="p-2 text-slate-100">{clientOf(job)}</td>
                        <td className="p-2 text-slate-300">{destinationOf(job)}</td>
                        <td className="p-2 text-right text-slate-100">{job.documentsCount ?? 0}</td>
                        <td className="p-2"><span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClass(job)}`}>{statusLabel(job)}</span></td>
                        <td className="whitespace-nowrap p-2 text-right">
                          {isBlocked(job) && (
                            <span className="inline-flex gap-2">
                              <button type="button" disabled={resolvingId === job.id} onClick={() => void resolve(job, "CONFIRM_SENT")} className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-50">Sí llegó</button>
                              <button type="button" disabled={resolvingId === job.id} onClick={() => void resolve(job, "ALLOW_RESEND")} className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-100 hover:bg-amber-500/20 disabled:opacity-50">Reenviar</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > MAX_ROWS && <p className="mt-2 text-xs text-slate-500">Se muestran los {MAX_ROWS} más recientes de {rows.length}. Usa el buscador para acotar.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}
