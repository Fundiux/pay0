"use client";

import { useEffect, useMemo, useState } from "react";
import { getClientCommissionRule, resolveCommissionInstrumentIq, saveClientCommissionRule, type CommissionRuleLeg } from "@/services/commissions";
import { watchClientBeneficiaries, watchClientBeneficiaryMethods, type ClientBeneficiaryRow, type ClientBeneficiaryMethodRow } from "@/services/beneficiaries";
import CommissionUserAssignments from "@/components/CommissionUserAssignments";

const emptyLeg = (kind: "BASE" | "COMMISSIONER" = "COMMISSIONER"): CommissionRuleLeg => ({ kind, alias: kind === "BASE" ? "BASE" : "", rateBps: 0, beneficiaryId: "", methodId: "", active: true });

export default function ClientCommissionRulePanel({ clientId, rootId, canEdit, canonicalRateBps }: { clientId: string; rootId: string; canEdit: boolean; canonicalRateBps?: number | null }) {
  const [totalRate, setTotalRate] = useState("0");
  const [legs, setLegs] = useState<CommissionRuleLeg[]>([emptyLeg("BASE")]);
  const [active, setActive] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [beneficiaries, setBeneficiaries] = useState<ClientBeneficiaryRow[]>([]);
  const [methods, setMethods] = useState<ClientBeneficiaryMethodRow[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [referencePaymentId, setReferencePaymentId] = useState("");

  useEffect(() => {
    getClientCommissionRule(clientId).then(({ rule }) => {
      if (!rule) return;
      setTotalRate((rule.totalRateBps / 100).toFixed(2)); setLegs(rule.legs); setActive(rule.active); setAutomationEnabled(rule.automationEnabled);
    }).catch((error) => setMessage(error?.message || "No se pudo cargar la regla."));
    const stopA = watchClientBeneficiaries(clientId, rootId, setBeneficiaries, (error) => setMessage(error.message));
    const stopB = watchClientBeneficiaryMethods(clientId, rootId, setMethods, (error) => setMessage(error.message));
    return () => { stopA(); stopB(); };
  }, [clientId, rootId]);
  useEffect(() => {
    if (Number.isInteger(canonicalRateBps) && Number(canonicalRateBps) > 0) setTotalRate((Number(canonicalRateBps) / 100).toFixed(2));
  }, [canonicalRateBps]);

  const assignedBps = useMemo(() => legs.reduce((sum, leg) => sum + Number(leg.rateBps || 0), 0), [legs]);
  const totalBps = Math.round(Number(totalRate || 0) * 100);
  const updateLeg = (index: number, patch: Partial<CommissionRuleLeg>) => setLegs((current) => current.map((leg, i) => i === index ? { ...leg, ...patch } : leg));
  async function save() {
    setSaving(true); setMessage("");
    try {
      const result = await saveClientCommissionRule({ clientId, totalRateBps: totalBps, legs: legs.map((leg, order) => ({ ...leg, order })), active, automationEnabled });
      setMessage(`Regla v${result.version} guardada.`);
    } catch (error: any) { setMessage(error?.message || "No se pudo guardar la regla."); }
    finally { setSaving(false); }
  }
  async function verifyLeg(index: number) {
    const leg = legs[index];
    if (!leg.methodId || !referencePaymentId.trim()) { setMessage("Indica un pago IQ conciliado del mismo cliente para verificar el instrumento."); return; }
    setSaving(true); setMessage("");
    try { const result = await resolveCommissionInstrumentIq({ methodId: leg.methodId, paymentId: referencePaymentId.trim() }); setMessage(result.ok ? `${leg.alias}: instrumento verificado inequívocamente en IQ.` : `${leg.alias}: ${result.status} (${result.reason || 'sin coincidencia inequívoca'}).`); }
    catch (error: any) { setMessage(error?.message || "No se pudo verificar el instrumento en IQ."); }
    finally { setSaving(false); }
  }

  return <section className="mt-6 rounded-2xl border border-orange-400/20 bg-orange-500/[0.04] p-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-sm font-semibold text-orange-100">Distribución de comisión</h3><p className="mt-1 text-xs text-slate-400">La comisión total proviene del costo final seleccionado. Aquí sólo se distribuye; la automatización permanece bloqueada si el instrumento no está verificado en IQ.</p></div><div className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-300">Comisión total canónica <strong className="ml-2 text-white">{totalRate}%</strong></div></div>
    {canEdit && <div className="mt-4"><label className="text-xs text-slate-400">Pago IQ conciliado para descubrir y verificar instrumentos<input value={referencePaymentId} onChange={(e) => setReferencePaymentId(e.target.value)} placeholder="ID interno del pago" className="ml-2 w-64 rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm text-white" /></label></div>}
    <div className="mt-4 space-y-2">{legs.map((leg, index) => { const selectedMethod = methods.find((row) => row.id === leg.methodId); const linkLabel = selectedMethod?.iqLinkStatus === 'VERIFIED' ? 'Verificado en IQ' : selectedMethod?.iqLinkStatus === 'AMBIGUOUS' ? 'Coincidencia ambigua' : selectedMethod?.iqLinkStatus === 'NOT_FOUND' ? 'No encontrado' : selectedMethod?.iqLinkStatus === 'STALE' ? 'Requiere revisión' : selectedMethod?.iqLinkStatus === 'ERROR' ? 'Error de verificación' : 'Pendiente de verificar'; return <div key={index} className="grid gap-2 rounded-xl border border-white/10 bg-black/10 p-3 md:grid-cols-[110px_1fr_110px_1fr_1fr_auto]">
      <select disabled={!canEdit || leg.kind === "BASE"} value={leg.kind} onChange={(e) => updateLeg(index, { kind: e.target.value as any })} className="rounded-lg bg-slate-950 px-2 py-2 text-sm"><option value="BASE">Base</option><option value="COMMISSIONER">Comisionista</option></select>
      <input disabled={!canEdit} value={leg.alias} onChange={(e) => updateLeg(index, { alias: e.target.value })} placeholder="Alias" className="rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm" />
      <input disabled={!canEdit} value={leg.rateBps / 100 || ""} onChange={(e) => updateLeg(index, { rateBps: Math.round(Number(e.target.value || 0) * 100) })} type="number" step="0.01" placeholder="%" className="rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm" />
      <select disabled={!canEdit} value={leg.beneficiaryId} onChange={(e) => updateLeg(index, { beneficiaryId: e.target.value, methodId: "" })} className="rounded-lg bg-slate-950 px-2 py-2 text-sm"><option value="">Beneficiario</option>{beneficiaries.filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{row.nombre}</option>)}</select>
      <select disabled={!canEdit || !leg.beneficiaryId} value={leg.methodId} onChange={(e) => updateLeg(index, { methodId: e.target.value })} className="rounded-lg bg-slate-950 px-2 py-2 text-sm"><option value="">Instrumento</option>{methods.filter((row) => row.active !== false && row.beneficiaryId === leg.beneficiaryId).map((row) => <option key={row.id} value={row.id}>{row.bankName} · {row.masked} · IQ {row.iqLinkStatus || 'PENDIENTE'}</option>)}</select>
      <div className="flex flex-col gap-1"><span className={selectedMethod?.iqLinkStatus === 'VERIFIED' ? 'text-xs text-emerald-300' : 'text-xs text-amber-300'}>{linkLabel}</span>{canEdit && <button onClick={() => void verifyLeg(index)} disabled={saving || !leg.methodId} className="text-xs text-sky-300 disabled:opacity-40">Verificar IQ</button>}{leg.kind !== "BASE" && canEdit ? <button onClick={() => setLegs((rows) => rows.filter((_, i) => i !== index))} className="text-xs text-rose-300">Quitar</button> : null}</div>
      <div className="md:col-span-6 grid gap-2 md:grid-cols-2"><select disabled={!canEdit} value={leg.deliveryPreference || 'MANUAL'} onChange={(e) => updateLeg(index, { deliveryPreference: e.target.value as CommissionRuleLeg['deliveryPreference'] })} className="rounded-lg bg-slate-950 px-2 py-2 text-sm"><option value="MANUAL">Entrega manual</option><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option><option value="NONE">Sin entrega</option></select><input disabled={!canEdit || !['EMAIL','WHATSAPP'].includes(leg.deliveryPreference || '')} value={leg.deliveryContact || ''} onChange={(e) => updateLeg(index, { deliveryContact: e.target.value })} placeholder="Contacto de entrega (opcional hasta probar envío)" className="rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-sm" /></div>
    </div>})}</div>
    <div className={`mt-3 text-sm ${assignedBps === totalBps ? "text-emerald-300" : "text-amber-300"}`}>Asignado {(assignedBps / 100).toFixed(2)}% · Disponible {((totalBps - assignedBps) / 100).toFixed(2)}%</div>
    {canEdit && <div className="mt-4 flex flex-wrap items-center gap-3"><button onClick={() => setLegs((rows) => [...rows, emptyLeg()])} className="rounded-lg border border-white/10 px-3 py-2 text-sm">Agregar destino</button><label className="text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="mr-2" />Regla activa</label><label className="text-sm"><input type="checkbox" checked={automationEnabled} onChange={(e) => setAutomationEnabled(e.target.checked)} className="mr-2" />Automatización activa</label><button disabled={saving || assignedBps !== totalBps} onClick={save} className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Guardando…" : "Guardar regla"}</button></div>}
    {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
    <CommissionUserAssignments clientId={clientId} methods={methods} referencePaymentId={referencePaymentId} />
  </section>;
}
