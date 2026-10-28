"use client";

import { MatBalanceCard } from "./MatBalanceCard";
import type { MatHomeItem, MatHomeMetric } from "@/services/telegramMiniApp";

type HomeSection = { label: string; metric?: string; target: string; detail: string };

export function MatHomeOverview({
  amount,
  linked,
  loading,
  metrics,
  sections,
  recent,
}: {
  amount: string;
  linked: boolean;
  loading: boolean;
  metrics: MatHomeMetric[];
  sections: HomeSection[];
  recent: MatHomeItem[];
}) {
  const metricValue = (label: string) =>
    metrics.find((metric) => metric.label.toLowerCase() === label.toLowerCase())?.value || "0";

  return (
    <div className="space-y-5 pb-3">
      <MatBalanceCard
        title="Saldo disponible"
        amount={loading ? "—" : amount}
        subtitle={loading ? "Cargando tu información" : linked ? "Tu operación PAY0, en un vistazo" : "Vincula tu cuenta para consultar datos reales"}
        status={!loading && !linked ? "Sin vincular" : undefined}
        statusTone="muted"
      />

      <section aria-label="Resumen de operación">
        <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
          <h2 className="text-base font-black text-white">Tu operación</h2>
          <span className="text-[11px] text-slate-400">Accesos rápidos</span>
        </div>
        <div className="space-y-2">
          {sections.map((section) => (
            <a
              key={section.target}
              href={`#${section.target}`}
              role="button"
              className="flex min-h-16 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-left transition active:scale-[0.99]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-white">{section.label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-400">{section.detail}</span>
              </span>
              {section.metric ? <span className="text-xl font-black tabular-nums text-cyan-200">{metricValue(section.metric)}</span> : null}
              <span aria-hidden="true" className="text-lg text-slate-500">›</span>
            </a>
          ))}
        </div>
      </section>

      {recent.length > 0 ? (
        <section aria-label="Actividad reciente" className="px-1">
          <h2 className="mb-3 text-base font-black text-white">Actividad reciente</h2>
          <div className="space-y-2">
            {recent.slice(0, 3).map((item) => (
              <div key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3">
                <p className="truncate text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-1 truncate text-xs text-slate-400">{item.caption || "Operación PAY0"}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
