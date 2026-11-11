"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAgentOperations, type AgentOperations } from "@/services/agentOperations";

type Group = NonNullable<AgentOperations["incidentGroups"]>[number];
const WHO = { SYSTEM: "Sistema", HUGO: "Hugo", PERSON: "Persona" } as const;
const money = (value: number, currency: string | null) => `$${value.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency && currency !== "MXN" ? ` ${currency}` : ""}`;

function subjectLine(group: Group) {
  const subject = group.subject;
  if (!subject) return "Registro sin datos disponibles";
  const word = subject.kind === "SOLICITUD" ? "Solicitud" : subject.kind === "PAGO" ? "Pago" : "Dispersión";
  return [subject.folio ? `${word} ${subject.folio}` : word, subject.clientName, subject.amount != null ? money(subject.amount, subject.currency) : null, subject.providerName].filter(Boolean).join(" · ");
}

/** Incidencias abiertas y resueltas hoy, solo para el superadministrador; si no se pueden cargar, la tarjeta no aparece. */
export function IncidentsCard() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  useEffect(() => {
    let alive = true;
    getAgentOperations().then(result => { if (alive) setGroups(result.incidentGroups ?? []); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!groups) return null;
  const open = groups.filter(group => group.status === "OPEN").length;
  return (
    <div className="mt-6 min-w-0 rounded-2xl border border-white/10 bg-[#161d2b] px-5 py-4 shadow-xl" style={{ borderLeft: "4px solid #fbbf24" }}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[12px] uppercase tracking-widest text-amber-300">Incidencias</div>
        <Link href="/hugo/operations" className="text-[11px] text-violet-300">Ver detalle</Link>
      </div>
      <div className="mt-1 text-[12px] text-slate-400">{open} abiertas · {groups.length - open} resueltas hoy</div>
      {!groups.length && <p className="mt-3 text-sm text-slate-500">Sin incidencias abiertas ni resueltas hoy.</p>}
      <ul className="mt-3 space-y-3">
        {groups.map(group => (
          <li key={group.id} className="text-sm text-white">
            <p>{subjectLine(group)} <span className="text-slate-400">— {group.causes.join("; ")}</span></p>
            <p className="text-xs text-slate-400">
              {group.status === "OPEN" ? "Resuelta automáticamente: No · Pendiente"
                : `Resuelta automáticamente: ${group.autoResolved ? "Sí" : "No"} · Resolvió: ${group.resolverTier ? WHO[group.resolverTier] : "sin dato"}${group.resolutionText ? ` · ${group.resolutionText}` : ""}`}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
