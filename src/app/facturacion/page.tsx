"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FilePlus2, Loader2, ReceiptText, RefreshCw, ShieldCheck } from "lucide-react";
import { useUserProfile } from "@/lib/useUserProfile";
import { useAuth } from "@/lib/auth";
import { listCompanies, type Company } from "@/services/companies";
import { getFacturamaSandboxStatus, listFacturamaInvoices, saveFacturamaDraft, type FacturamaConcept, type FacturamaInvoice } from "@/services/facturama";

const initialConcept: FacturamaConcept = { productCode: "84111506", description: "Servicios administrativos", unitCode: "E48", unit: "Unidad de servicio", quantity: 1, unitPrice: 0, taxObject: "02" };
const inputClass = "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-emerald-500";

function money(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value || 0));
}
function date(value: any) {
  const ms = value?.seconds ? value.seconds * 1000 : value ? new Date(value).getTime() : 0;
  return ms ? new Date(ms).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "Ahora";
}
function newKey() {
  return globalThis.crypto?.randomUUID?.() || `cfdi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function FacturacionPage() {
  const { profile } = useUserProfile();
  const { user } = useAuth();
  const allowed = profile?.role === "superadmin";
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [invoices, setInvoices] = useState<FacturamaInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [receiver, setReceiver] = useState({ rfc: "", name: "", fiscalRegime: "", postalCode: "", cfdiUse: "G03" });
  const [concepts, setConcepts] = useState<FacturamaConcept[]>([{ ...initialConcept }]);
  const [paymentForm, setPaymentForm] = useState("03");
  const [paymentMethod, setPaymentMethod] = useState("PUE");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");

  const subtotal = useMemo(() => concepts.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0), [concepts]);
  const refresh = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [status, rows] = await Promise.all([getFacturamaSandboxStatus(), listFacturamaInvoices(companyId)]);
      setConfigured(status.configured);
      setInvoices(rows.invoices || []);
    } catch (error: any) {
      setMessage(`No se pudo cargar Facturación: ${error?.message || error}`);
    } finally { setLoading(false); }
  }, [allowed, companyId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!allowed || !user?.uid || !profile?.role) return;
    return listCompanies({ uid: user.uid, role: profile.role }, (items) => {
      const active = items.filter((item) => item.active !== false);
      setCompanies(active);
      setCompanyId((current) => current || active[0]?.id || "");
    }, (error) => setMessage(`No se pudo cargar empresas emisoras: ${error?.message || error}`));
  }, [allowed, profile?.role, user?.uid]);

  function updateConcept(index: number, key: keyof FacturamaConcept, value: string) {
    setConcepts((current) => current.map((concept, i) => i === index ? { ...concept, [key]: key === "quantity" || key === "unitPrice" ? Number(value) : value } : concept));
  }
  async function saveDraft() {
    setSaving(true); setMessage("");
    try {
      const result = await saveFacturamaDraft({ idempotencyKey: newKey(), companyId, receiver, concepts, paymentForm, paymentMethod, currency: "MXN" });
      setMessage(result.reused ? "El borrador ya existía; se conservó el mismo registro." : "Borrador CFDI guardado. Aún no se timbra ni genera efectos fiscales.");
      await refresh();
    } catch (error: any) { setMessage(`Revisa los datos fiscales: ${error?.message || error}`); }
    finally { setSaving(false); }
  }

  if (!allowed) return <main className="p-6 text-slate-400">Facturación está restringida a superadministración.</main>;
  return <main className="min-h-full p-4 sm:p-6">
    <section className="mb-6 overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950/70 via-slate-950 to-slate-950 p-6 shadow-2xl shadow-emerald-950/20">
      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-start"><div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300"><ReceiptText size={16} /> CFDI 4.0 · Facturama</div>
        <h1 className="text-3xl font-semibold text-white">Facturación desde PAY0</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">Crea y controla tus comprobantes desde la operación. Esta primera entrega guarda borradores auditables y opera únicamente en ambiente sandbox; no timbra documentos reales todavía.</p>
      </div><div className="rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-sm">
        <div className="flex items-center gap-2 font-medium text-slate-100"><ShieldCheck size={17} className={configured ? "text-emerald-400" : "text-amber-400"} /> Sandbox {configured ? "configurado" : "pendiente de credenciales"}</div>
        <p className="mt-1 text-xs text-slate-400">Producción permanece bloqueada hasta validar emisor, CSD y flujo de timbrado.</p>
      </div></div>
    </section>

    {message && <div className="mb-5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">{message}</div>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-semibold text-white">Nuevo borrador CFDI</h2><p className="text-sm text-slate-400">Los datos se validan en servidor y quedan ligados a tu root PAY0.</p></div><FilePlus2 className="text-emerald-400" /></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-slate-400">Empresa emisora<select className={inputClass} value={companyId} onChange={(e) => setCompanyId(e.target.value)}><option value="">Selecciona una empresa</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.nombre} · {company.rfc}</option>)}</select></label><label className="text-xs text-slate-400">RFC receptor<input className={inputClass} value={receiver.rfc} onChange={(e) => setReceiver({ ...receiver, rfc: e.target.value.toUpperCase() })} placeholder="XAXX010101000" /></label><label className="text-xs text-slate-400">Razón social<input className={inputClass} value={receiver.name} onChange={(e) => setReceiver({ ...receiver, name: e.target.value })} placeholder="Nombre o razón social" /></label><label className="text-xs text-slate-400">Régimen fiscal<select className={inputClass} value={receiver.fiscalRegime} onChange={(e) => setReceiver({ ...receiver, fiscalRegime: e.target.value })}><option value="">Selecciona</option><option value="601">601 General de Ley</option><option value="603">603 Personas Morales</option><option value="612">612 Personas Físicas</option><option value="616">616 Sin obligaciones</option></select></label><label className="text-xs text-slate-400">Código postal<input className={inputClass} value={receiver.postalCode} onChange={(e) => setReceiver({ ...receiver, postalCode: e.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="00000" /></label><label className="text-xs text-slate-400">Uso CFDI<select className={inputClass} value={receiver.cfdiUse} onChange={(e) => setReceiver({ ...receiver, cfdiUse: e.target.value })}><option value="G03">G03 Gastos en general</option><option value="S01">S01 Sin efectos fiscales</option><option value="D01">D01 Honorarios médicos</option></select></label><label className="text-xs text-slate-400">Método / forma de pago<div className="mt-1 flex gap-2"><select className="w-1/2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option>PUE</option><option>PPD</option></select><select className="w-1/2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" value={paymentForm} onChange={(e) => setPaymentForm(e.target.value)}><option value="03">03 Transferencia</option><option value="01">01 Efectivo</option><option value="99">99 Por definir</option></select></div></label></div>
        <div className="mt-7"><div className="mb-3 flex items-center justify-between"><h3 className="font-medium text-white">Conceptos</h3><button type="button" className="text-sm text-emerald-300 hover:text-emerald-200" onClick={() => setConcepts([...concepts, { ...initialConcept }])}>+ Agregar concepto</button></div>
          <div className="space-y-3">{concepts.map((concept, index) => <div key={index} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="grid gap-2 sm:grid-cols-6"><input className={inputClass} aria-label="Clave SAT" value={concept.productCode} onChange={(e) => updateConcept(index, "productCode", e.target.value)} placeholder="Clave SAT" /><input className="sm:col-span-2 mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm" value={concept.description} onChange={(e) => updateConcept(index, "description", e.target.value)} placeholder="Descripción" /><input className={inputClass} value={concept.quantity} type="number" min="0.000001" onChange={(e) => updateConcept(index, "quantity", e.target.value)} placeholder="Cant." /><input className={inputClass} value={concept.unitPrice} type="number" min="0" step="0.01" onChange={(e) => updateConcept(index, "unitPrice", e.target.value)} placeholder="Precio" /><select className={inputClass} value={concept.taxObject} onChange={(e) => updateConcept(index, "taxObject", e.target.value)}><option value="02">02 IVA</option><option value="01">01 No objeto</option><option value="03">03 Exento</option></select></div>{concepts.length > 1 && <button className="mt-2 text-xs text-rose-300" onClick={() => setConcepts(concepts.filter((_, i) => i !== index))}>Quitar concepto</button>}</div>)}</div>
        </div>
        <div className="mt-6 flex flex-col items-end gap-3 border-t border-slate-800 pt-5"><div className="text-sm text-slate-400">Subtotal estimado <strong className="ml-3 text-lg text-white">{money(subtotal)}</strong></div><button type="button" disabled={saving} onClick={saveDraft} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60">{saving ? <Loader2 size={17} className="animate-spin" /> : <FilePlus2 size={17} />}{saving ? "Guardando..." : "Guardar borrador CFDI"}</button></div>
      </section>
      <aside className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-white">Borradores recientes</h2><p className="text-xs text-slate-400">Preparados para validación.</p></div><button onClick={() => void refresh()} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800" aria-label="Actualizar"><RefreshCw size={17} className={loading ? "animate-spin" : ""} /></button></div><div className="mt-4 space-y-3">{!loading && !invoices.length && <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Aún no hay borradores. Crea el primero desde este módulo.</p>}{invoices.map((invoice) => <article key={invoice.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="flex items-center justify-between"><span className="rounded-full bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-300">{invoice.status}</span><span className="text-xs text-slate-500">{date(invoice.createdAt)}</span></div><p className="mt-2 text-sm font-medium text-slate-100">{invoice.receiver?.name || invoice.receiver?.rfc}</p><p className="text-xs text-slate-400">{invoice.receiver?.rfc} · {money(invoice.subtotal)}</p></article>)}</div></aside>
    </div>
  </main>;
}
