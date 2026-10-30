"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole } from "@/lib/roles";
import { belongsToSystem, SYSTEM_ACTIVITY_COLLECTIONS } from "@/lib/systemActivity";
import { buildActivityLogQuery } from "@/lib/activityLogQuery";
import { normalizeActivityEventKey } from "@/lib/activityEventLabels";

type Props = { from?: Date; to?: Date };
const normalSolicitudEvents = new Set(["SOLICITUD_CREADA", "DOCUMENTO_SOLICITUD_SUBIDO", "IQ_SOLICITUD_ENCOLADA", "IQ_SOLICITUD_COLA_REUTILIZADA", "IQ_SOLICITUD_CREACION_INICIADA", "IQ_SOLICITUD_CREACION_EXITOSA", "COTIZACION_ENCOLADA", "COTIZACION_GENERADA"]);
const warningEvents = new Set(["COTIZACION_FALLIDA_REINTENTO", "IQ_SOLICITUD_CREACION_FALLIDA", "IQ_SOLICITUD_RESULTADO_INCIERTO", "SOLICITUD_RECHAZADA"]);
const clean = (v: unknown) => String(v ?? "").trim();

export default function DashboardActivity({ from, to }: Props) {
  const { user } = useAuth(); const { profile } = useUserProfile();
  const [events, setEvents] = useState<any[]>([]); const [loading, setLoading] = useState(true);
  const uid = user?.uid || ""; const role = normalizeRole((profile as any)?.role); const rootId = String((profile as any)?.rootId || uid || "");
  useEffect(() => {
    if (!uid || !role) return; setLoading(true);
    const byCollection = new Map<string, any[]>();
    const publish = () => setEvents(Array.from(byCollection.values()).flat().filter(row => belongsToSystem(row, "PAY0")).sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0)).slice(0, 300));
    const unsubs = [SYSTEM_ACTIVITY_COLLECTIONS.PAY0, "activityLog"].map(name => onSnapshot(buildActivityLogQuery(db, name, { uid, role, rootId, maxRows: 300 }), snap => { byCollection.set(name, snap.docs.map(doc => ({ id: `${name}:${doc.id}`, ...doc.data() }))); publish(); setLoading(false); }, () => setLoading(false)));
    return () => unsubs.forEach(unsub => unsub());
  }, [uid, role, rootId]);
  const rows = useMemo(() => {
    const ranged = events.filter(event => { const ms = Number(event.createdAt?.seconds || 0) * 1000; return (!from || ms >= from.getTime()) && (!to || ms <= to.getTime()); });
    const requestGroups = new Map<string, any[]>(); const other: any[] = [];
    for (const event of ranged) { const key = normalizeActivityEventKey(event.event || event.type); const solicitudId = clean(event.entityType).toLowerCase().startsWith("solicitud") ? clean(event.entityId || event.referenceId) : ""; if (solicitudId && (normalSolicitudEvents.has(key) || warningEvents.has(key))) requestGroups.set(solicitudId, [...(requestGroups.get(solicitudId) || []), event]); else other.push(event); }
    const summaries = Array.from(requestGroups.entries()).map(([solicitudId, group]) => {
      const keys = new Set(group.map(e => normalizeActivityEventKey(e.event || e.type))); const newest = group[0]; const extra = newest.extra || {};
      const warning = group.find(e => warningEvents.has(normalizeActivityEventKey(e.event || e.type)));
      const iq = group.find(e => clean(e.extra?.iqFolio || e.extra?.iqId))?.extra?.iqFolio || group.find(e => clean(e.extra?.iqId))?.extra?.iqId;
      const state = warning ? "Atencion: cotizacion pendiente de reintento" : keys.has("COTIZACION_GENERADA") ? `Expediente completo · IQ ${iq || "creado"} · Cotizacion lista` : keys.has("IQ_SOLICITUD_CREACION_EXITOSA") ? `OC recibida · IQ ${iq || "creado"} · Cotizacion pendiente` : keys.has("IQ_SOLICITUD_ENCOLADA") ? "OC recibida · IQ en cola" : "Solicitud creada";
      const batchId = clean(group.find(e => clean(e.extra?.batchId))?.extra?.batchId);
      return { id: solicitudId, when: Number(newest.createdAt?.seconds || 0), folio: clean(newest.referenceFolio || newest.solicitudFolio || solicitudId), name: clean(extra.clienteNombre || extra.clientName || "Solicitud"), amount: Number(newest.amount || 0), state, warning: Boolean(warning), batchId, quotationReady: keys.has("COTIZACION_GENERADA"), iqCreated: keys.has("IQ_SOLICITUD_CREACION_EXITOSA") };
    });
    const batched = new Map<string, typeof summaries>(); const standalone = [] as typeof summaries;
    for (const row of summaries) { if (row.batchId) batched.set(row.batchId, [...(batched.get(row.batchId) || []), row]); else standalone.push(row); }
    const batchRows = Array.from(batched.entries()).map(([batchId, items]) => {
      if (items.length === 1) return items[0];
      const ready = items.filter(item => item.quotationReady).length, iq = items.filter(item => item.iqCreated).length, attention = items.filter(item => item.warning).length;
      return { id: `batch:${batchId}`, batchId, when: Math.max(...items.map(item => item.when)), folio: `Lote de ${items.length}`, name: `${iq} IQ creadas`, amount: 0, warning: attention > 0, state: `${ready}/${items.length} cotizaciones listas${attention ? ` · ${attention} requiere${attention === 1 ? "" : "n"} atención` : ""}`, items };
    });
    return [...batchRows, ...standalone, ...other.map(event => ({ id: event.id, when: Number(event.createdAt?.seconds || 0), folio: clean(event.referenceFolio || event.referenceId || "Operacion"), name: clean(event.description || event.event), amount: Number(event.amount || 0), state: clean(event.description || event.event), warning: warningEvents.has(normalizeActivityEventKey(event.event || event.type)) }))].sort((a, b) => b.when - a.when).slice(0, 30);
  }, [events, from, to]);
  return <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur"><div className="mb-4 flex items-end justify-between gap-4"><div><h2 className="text-base font-semibold text-slate-100">Actividad reciente</h2><p className="text-[11px] text-slate-500">Resumen operativo; la bitacora completa no se modifica.</p></div><Link href="/activity-log" className="text-xs text-sky-300 hover:text-sky-200">Ver actividad completa</Link></div>{loading ? <div className="pay0-empty-cell">Cargando actividad...</div> : !rows.length ? <div className="pay0-empty-cell">No hay actividad para este filtro.</div> : <div className="space-y-2">{rows.map(row => <Link key={row.id} href={`/activity-log?solicitudId=${encodeURIComponent(row.id)}`} className={`block rounded-xl border px-4 py-3 ${row.warning ? "border-amber-500/40 bg-amber-500/10" : "border-white/10 bg-black/10 hover:bg-white/5"}`}><div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><span className="font-mono text-sky-300">{row.folio}</span><span className="text-slate-300">· {row.name}</span>{row.amount > 0 && <span className="text-slate-400">· {row.amount.toLocaleString("es-MX", { style: "currency", currency: "MXN" })}</span>}</div><p className={`mt-1 text-xs ${row.warning ? "text-amber-200" : "text-slate-400"}`}>{row.state}</p></Link>)}</div>}</section>;
}
