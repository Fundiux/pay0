"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { listPagosSinSolicitud } from "@/services/pagosSinSolicitud";
import { getPendingOperationsSummary, type PendingOperationsItems } from "@/services/pendingSummary";

type Props = { canSeeUnmatched: boolean; canSeeOperations: boolean };

function PendingCard({ title, value, color, href, hint }: { title: string; value: number; color: string; href?: string; hint?: string }) {
  const body = (
    <div className="rounded-2xl border border-white/10 bg-[#161d2b] px-5 py-4 shadow-xl" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="text-[12px] font-normal uppercase tracking-widest" style={{ color }}>{title}</div>
      <div className="mt-2 text-[28px] font-normal tabular-nums text-white">{value}</div>
      {hint && <div className="mt-2 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{body}</Link> : body;
}

/** Pending items for the owner; a figure that cannot be loaded is left out instead of shown as zero. */
export function PendingItemsCards({ canSeeUnmatched, canSeeOperations }: Props) {
  const [unmatched, setUnmatched] = useState<{ a: number; b: number } | null>(null);
  const [items, setItems] = useState<PendingOperationsItems | null>(null);

  useEffect(() => {
    let alive = true;
    if (canSeeUnmatched) {
      listPagosSinSolicitud().then(result => {
        if (alive) setUnmatched({ a: result.rows.filter(row => row.case === "A").length, b: result.rows.filter(row => row.case === "B").length });
      }).catch(() => undefined);
    }
    if (canSeeOperations) getPendingOperationsSummary().then(result => { if (alive) setItems(result); }).catch(() => undefined);
    return () => { alive = false; };
  }, [canSeeUnmatched, canSeeOperations]);

  const operations: { title: string; value: number | undefined; hint: string }[] = [
    { title: "Complementos detenidos en IQ", value: items?.complementsHeld, hint: "Pausados, bloqueados o con estado desconocido." },
    { title: "Complementos sin llegar", value: items?.complementsLate, hint: "Solicitados hace más de 5 días." },
    { title: "Efectivo sin recibo firmado", value: items?.cashUnsigned, hint: "Dispersiones en efectivo registradas." },
    { title: "Cancelaciones en revisión", value: items?.cancellationReview, hint: "Solicitudes canceladas en IQ por revisar." },
  ];
  const shown = operations.filter(row => typeof row.value === "number");
  if (!unmatched && !shown.length) return null;
  return (
    <div className="mt-6 min-w-0">
      <div className="mb-2 text-[12px] uppercase tracking-widest text-slate-400">Pendientes</div>
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {unmatched && <PendingCard title="Pagos sin solicitud" value={unmatched.a} color="#f87171" href="/pagos" hint="Pagos del cliente sin solicitud aún." />}
        {unmatched && <PendingCard title="Pagos que no coinciden" value={unmatched.b} color="#fb923c" href="/pagos" hint="El cliente tiene facturas pendientes, pero ninguna coincide." />}
        {shown.map(row => <PendingCard key={row.title} title={row.title} value={row.value as number} color={row.value ? "#fbbf24" : "#34d399"} hint={row.hint} />)}
      </div>
    </div>
  );
}
