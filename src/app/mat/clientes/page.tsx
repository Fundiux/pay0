"use client";

import { useState } from "react";
import { MatSolicitudDocuments } from "@/components/mat/MatSolicitudDocuments";

import { MatHomeOverview } from "@/components/mat/MatHomeOverview";
import { MatCarousel2D, type MatCarouselSlide } from "@/components/mat/MatCarousel2D";
import { MatShell } from "@/components/mat/MatShell";
import { useMatClientHome } from "@/components/mat/useMatHome";
import type { MatHomeItem, MatHomeMetric } from "@/services/telegramMiniApp";

const navItems = [
  { key: "inicio", label: "Inicio", icon: "I", targetId: "inicio" },
  { key: "solicitudes", label: "Solicitudes", icon: "S", targetId: "solicitudes" },
  { key: "pagos", label: "Pagos", icon: "P", targetId: "pagos" },
  { key: "dispersiones", label: "Disp.", icon: "D", targetId: "dispersiones" },
  { key: "docs", label: "Movs.", icon: "M", targetId: "docs" },
];

function formatMoney(value: number) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getItemAmount(item: MatHomeItem) {
  const raw = (item as any)?.amount || (item as any)?.monto || (item as any)?.total || "";
  if (typeof raw === "number") return formatMoney(raw);
  return String(raw || (item as any)?.amount || "$0.00");
}

function getItemStatus(item: MatHomeItem) {
  return String((item as any)?.status || (item as any)?.estado || "PENDIENTE");
}

function getItemCaption(item: MatHomeItem) {
  return String((item as any)?.caption || (item as any)?.empresaNombre || "Operacion PAY0");
}

function sortItems(items: MatHomeItem[]) {
  return [...items]
    .sort((a, b) => Number((b as any)?.createdAtMillis || 0) - Number((a as any)?.createdAtMillis || 0))
    .slice(0, 8);
}

function OperationList({
  title,
  items,
  empty,
  onSelect,
}: {
  title: string;
  items: MatHomeItem[];
  empty: string;
  onSelect?: (item: MatHomeItem) => void;
}) {
  if (!items.length) {
    return (
      <div className="rounded-[26px] border border-dashed border-white/10 bg-slate-950/40 p-5 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-black text-cyan-100">
          P0
        </div>
        <div className="text-sm font-black text-white">Sin datos disponibles</div>
        <div className="mt-1 text-xs leading-5 text-slate-500">{empty}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{title}</div>
      {items.map((item) => (
        <article key={item.id} className="rounded-[24px] border border-white/10 bg-slate-950/45 p-3">
          {onSelect ? <button type="button" onClick={() => onSelect(item)} className="w-full text-left" aria-label={`Ver documentos de ${item.title}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-white">{item.title}</div>
              <div className="mt-1 truncate text-xs text-slate-500">{getItemCaption(item)}</div>
              <div className="mt-2 text-[11px] font-semibold text-cyan-300">Ver documentos ›</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-black text-cyan-100">{getItemAmount(item)}</div>
              <div className="mt-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[9px] font-black uppercase text-slate-300">
                {getItemStatus(item)}
              </div>
            </div>
          </div>
          </button> : <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-black text-white">{item.title}</div><div className="mt-1 truncate text-xs text-slate-500">{getItemCaption(item)}</div></div><div className="shrink-0 text-right"><div className="text-sm font-black text-cyan-100">{getItemAmount(item)}</div><div className="mt-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[9px] font-black uppercase text-slate-300">{getItemStatus(item)}</div></div></div>}
        </article>
      ))}
    </div>
  );
}

export default function MatClientesPage() {
  const { home, loading, error } = useMatClientHome();
  const [docsSolicitud, setDocsSolicitud] = useState<MatHomeItem | null>(null);

  const solicitudes = home?.linked ? sortItems(home.solicitudes || []) : [];
  const dispersiones = home?.linked ? sortItems(home.dispersiones || []) : [];
  const movimientos = home?.linked ? sortItems(home.movements || []) : [];
  const pagosFromHome = (((home as any)?.pagos || []) as MatHomeItem[]);
  const pagosFromMovements = movimientos.filter((item) => /pago|payment|abono/i.test(`${item.title} ${item.status} ${getItemCaption(item)}`));
  const pagos = home?.linked ? sortItems(pagosFromHome.length ? pagosFromHome : pagosFromMovements) : [];
  const sectionMetrics: MatHomeMetric[] = [
    { label: "Solicitudes", value: String(solicitudes.length) },
    { label: "Pagos", value: String(pagos.length) },
    { label: "Dispersiones", value: String(dispersiones.length) },
  ];

  const amount = home?.linked ? formatMoney(home.balance?.availableBalance || 0) : "$0.00";
  const identityLabel = home?.clienteNombre || "Cliente";
  const recent = sortItems([...solicitudes, ...pagos, ...dispersiones]);

  const slides: MatCarouselSlide[] = [
    {
      id: "inicio",
      eyebrow: "Home",
      title: "Operacion PAY0",
      description: "Resumen de tu operación PAY0.",
      icon: "P0",
      actionLabel: "Nueva solicitud",
      children: (
        <div>
          {error ? <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}
          <MatHomeOverview
            amount={amount}
            linked={Boolean(home?.linked)}
            loading={loading}
            metrics={sectionMetrics}
            sections={[
              { label: "Solicitudes", metric: "Solicitudes", target: "solicitudes", detail: "Folios recientes de tu cuenta" },
              { label: "Pagos", metric: "Pagos", target: "pagos", detail: "Movimientos recientes de pago" },
              { label: "Dispersiones", metric: "Dispersiones", target: "dispersiones", detail: "Envíos recientes de tu cuenta" },
              { label: "Movimientos", target: "docs", detail: "Actividad de tu saldo" },
            ]}
            recent={recent}
          />
        </div>
      ),
    },
    {
      id: "solicitudes",
      eyebrow: "Solicitudes",
      title: "Tus solicitudes",
      description: "Consulta los folios recientes vinculados a tu cuenta.",
      icon: "S",
      actionLabel: "Nueva solicitud",
      children: (
        <div className="space-y-4">
          <OperationList title="Solicitudes recientes" items={solicitudes} empty="Aun no hay solicitudes visibles para este cliente." onSelect={setDocsSolicitud} />
        </div>
      ),
    },
    {
      id: "pagos",
      eyebrow: "Pagos",
      title: "Tus pagos",
      description: "Consulta los pagos recientes visibles para tu cuenta.",
      icon: "P",
      actionLabel: "Subir pago",
      children: (
        <div className="space-y-4">
          <OperationList title="Pagos recientes" items={pagos} empty="Aun no hay pagos visibles para este cliente." />
        </div>
      ),
    },
    {
      id: "dispersiones",
      eyebrow: "Dispersiones",
      title: "Tus dispersiones",
      description: "Consulta las dispersiones recientes vinculadas a tu cuenta.",
      icon: "D",
      actionLabel: "Solicitar retorno",
      children: (
        <div className="space-y-4">
          <OperationList title="Dispersiones recientes" items={dispersiones} empty="Aun no hay dispersiones visibles para este cliente." />
        </div>
      ),
    },
    {
      id: "docs",
      eyebrow: "Movimientos",
      title: "Actividad de tu saldo",
      description: "Consulta los movimientos recientes asociados a tu cuenta.",
      icon: "M",
      children: (
        <OperationList title="Movimientos recientes" items={movimientos} empty="Aún no hay movimientos visibles para esta cuenta." />
      ),
    },
  ];

  return (
    <MatShell title="Clientes" identityLabel={identityLabel} loading={loading} activeNav="inicio" navItems={navItems}>
      <MatCarousel2D slides={slides} />
      {docsSolicitud && <MatSolicitudDocuments solicitudId={docsSolicitud.id} folio={docsSolicitud.caption.split(" · ")[0]} scope="CLIENTS" onClose={() => setDocsSolicitud(null)} />}
    </MatShell>
  );
}
