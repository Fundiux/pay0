"use client";

import { MatBalanceCard } from "@/components/mat/MatBalanceCard";
import { MatCarousel2D, type MatCarouselSlide } from "@/components/mat/MatCarousel2D";
import { MatShell } from "@/components/mat/MatShell";
import { useMatUserHome } from "@/components/mat/useMatHome";
import { formatMatTrustWindow, type MatActorScope } from "@/lib/matSecurityPolicy";
import type { MatHomeItem, MatHomeMetric } from "@/services/telegramMiniApp";

const navItems = [
  { key: "inicio", label: "Inicio", icon: "I", targetId: "inicio" },
  { key: "solicitudes", label: "Solicitudes", icon: "S", targetId: "solicitudes" },
  { key: "pagos", label: "Pagos", icon: "P", targetId: "pagos" },
  { key: "dispersiones", label: "Disp.", icon: "D", targetId: "dispersiones" },
  { key: "docs", label: "Docs", icon: "X", targetId: "docs" },
];

const emptyMetrics: MatHomeMetric[] = [
  { label: "Clientes", value: "0" },
  { label: "Solicitudes", value: "0" },
  { label: "Pagos", value: "0" },
  { label: "Dispersiones", value: "0" },
];

function formatMoney(value: number) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function goToTarget(targetId: string) {
  const target = document.getElementById(targetId);
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });

  if (window.history?.replaceState) {
    window.history.replaceState(null, "", `#${targetId}`);
  }
}

function getMetricValue(metrics: MatHomeMetric[], label: string) {
  return metrics.find((metric) => metric.label.toLowerCase() === label.toLowerCase())?.value || "0";
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
  return String(
    (item as any)?.caption ||
      (item as any)?.clienteNombre ||
      (item as any)?.empresaNombre ||
      "Operacion PAY0",
  );
}

function sortItems(items: MatHomeItem[]) {
  return [...items]
    .sort((a, b) => Number((b as any)?.createdAtMillis || 0) - Number((a as any)?.createdAtMillis || 0))
    .slice(0, 8);
}

function HomeShortcut({
  label,
  value,
  targetId,
}: {
  label: string;
  value: string;
  targetId: string;
}) {
  return (
    <a
      role="button"
      href={`#${targetId}`}
      onClick={() => goToTarget(targetId)}
      className="block rounded-[24px] border border-white/10 bg-slate-950/45 p-4 text-left active:scale-[0.99]"
    >
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-2 truncate text-2xl font-black text-white">{value}</div>
    </a>
  );
}

function OperationList({
  title,
  items,
  empty,
}: {
  title: string;
  items: MatHomeItem[];
  empty: string;
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
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-white">{item.title}</div>
              <div className="mt-1 truncate text-xs text-slate-500">{getItemCaption(item)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-black text-cyan-100">{getItemAmount(item)}</div>
              <div className="mt-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-1 text-[9px] font-black uppercase text-slate-300">
                {getItemStatus(item)}
              </div>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function ActionPanel({
  primary,
  secondary,
  pinReason,
}: {
  primary: string;
  secondary: string;
  pinReason?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <button
        type="button"
        title={pinReason || primary}
        className="rounded-[26px] bg-cyan-300 p-4 text-left text-slate-950 shadow-xl shadow-cyan-950/30 active:scale-[0.99]"
      >
        <div className="text-xs font-black uppercase tracking-[0.12em]">Accion</div>
        <div className="mt-1 text-lg font-black">{primary}</div>
      </button>
      <button type="button" className="rounded-[26px] border border-white/10 bg-white/[0.07] p-4 text-left active:scale-[0.99]">
        <div className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Ver</div>
        <div className="mt-1 text-lg font-black text-white">{secondary}</div>
      </button>
    </div>
  );
}

export default function MatUsuariosPage() {
  const { home, loading, error } = useMatUserHome();

  const isSuperadmin = String(home?.role || "").toLowerCase() === "superadmin";
  const actorScope: MatActorScope = isSuperadmin ? "SUPERADMIN" : "USER";
  const trustWindow = formatMatTrustWindow(actorScope);

  const metrics = home?.linked && home?.metrics?.length ? home.metrics : emptyMetrics;
  const solicitudes = home?.linked ? sortItems(home.solicitudes || []) : [];
  const dispersiones = home?.linked ? sortItems(home.dispersiones || []) : [];
  const movimientos = home?.linked ? sortItems(home.movements || []) : [];
  const pagosFromHome = (((home as any)?.pagos || []) as MatHomeItem[]);
  const pagosFromMovements = movimientos.filter((item) => /pago|payment|abono/i.test(`${item.title} ${getItemCaption(item)}`));
  const pagos = home?.linked ? sortItems(pagosFromHome.length ? pagosFromHome : pagosFromMovements) : [];

  const rows = metrics.slice(0, 4).map((metric) => ({ label: metric.label, value: metric.value }));

  const amount = home?.linked ? formatMoney(home.balance?.availableBalance || 0) : "$0.00";
  const identityLabel = home?.displayName || (home as any)?.username || "Usuario";
  const subtitle = home?.linked
    ? `${identityLabel}${home.role ? ` | ${home.role}` : ""}`
    : "Conecta desde Telegram para ver informacion real";
  const status = loading ? "CARGANDO" : home?.linked ? "REAL" : "NAVEGADOR";

  const slides: MatCarouselSlide[] = [
    {
      id: "inicio",
      eyebrow: "Home",
      title: "Operacion PAY0",
      description: `Biometrico en dispositivo confiable. PIN despues de ${trustWindow} sin uso o accion sensible.`,
      icon: "P0",
      actionLabel: "Nueva solicitud",
      children: (
        <div className="space-y-4">
          {error ? <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}

          <MatBalanceCard
            title="Saldo usuario"
            amount={amount}
            subtitle={home?.linked ? home.message || "Informacion real PAY0" : "Sin cuenta vinculada"}
            status={status}
            statusTone={home?.linked ? "ok" : "muted"}
            rows={rows}
          />

          <div className="grid grid-cols-2 gap-3">
            <HomeShortcut label="Solicitudes" value={getMetricValue(metrics, "Solicitudes")} targetId="solicitudes" />
            <HomeShortcut label="Pagos" value={getMetricValue(metrics, "Pagos")} targetId="pagos" />
            <HomeShortcut label="Dispersiones" value={getMetricValue(metrics, "Dispersiones")} targetId="dispersiones" />
            <HomeShortcut label="Clientes" value={getMetricValue(metrics, "Clientes")} targetId="docs" />
          </div>
        </div>
      ),
    },
    {
      id: "solicitudes",
      eyebrow: "Solicitudes",
      title: "Crear y revisar",
      description: "Crear solicitud con OC obligatoria y revisar folios.",
      icon: "S",
      actionLabel: "Nueva solicitud",
      children: (
        <div className="space-y-4">
          <ActionPanel primary="Nueva solicitud" secondary="Ver folios" />
          <OperationList title="Solicitudes recientes" items={solicitudes} empty="Aun no hay solicitudes visibles para esta cuenta." />
        </div>
      ),
    },
    {
      id: "pagos",
      eyebrow: "Pagos",
      title: "Comprobantes",
      description: "Subir comprobantes y revisar conciliacion.",
      icon: "P",
      actionLabel: "Subir pago",
      children: (
        <div className="space-y-4">
          <ActionPanel primary="Subir pago" secondary="Ver pagos" />
          <OperationList title="Pagos recientes" items={pagos} empty="Aun no hay pagos visibles para esta cuenta." />
        </div>
      ),
    },
    {
      id: "dispersiones",
      eyebrow: "Dispersiones",
      title: "Enviar fondos",
      description: "PIN solo para la primera dispersion de la ventana activa.",
      icon: "D",
      actionLabel: "Nueva dispersion",
      pinReason: "Requiere PIN PAY0 para primera dispersion.",
      children: (
        <div className="space-y-4">
          <ActionPanel primary="Nueva dispersion" secondary="Beneficiarios" pinReason="Requiere PIN PAY0 para primera dispersion." />
          <OperationList title="Dispersiones recientes" items={dispersiones} empty="Aun no hay dispersiones visibles para esta cuenta." />
        </div>
      ),
    },
    {
      id: "docs",
      eyebrow: "Docs",
      title: "Documentos",
      description: "Facturas, OC, XML, PDF, comprobantes y evidencias.",
      icon: "X",
      actionLabel: "Ver docs",
      children: (
        <div className="space-y-3">
          <ActionPanel primary="Abrir docs" secondary="Subir archivo" />
          <div className="grid grid-cols-2 gap-3">
            <HomeShortcut label="Facturas" value="PDF/XML" targetId="docs" />
            <HomeShortcut label="OC" value="Soporte" targetId="docs" />
            <HomeShortcut label="Pagos" value="Comprobantes" targetId="pagos" />
            <HomeShortcut label="Evidencia" value="Operativa" targetId="docs" />
          </div>
        </div>
      ),
    },
  ];

  return (
    <MatShell title="Usuarios" subtitle={subtitle} identityLabel={identityLabel} badge="Mini App Telegram" activeNav="inicio" navItems={navItems} botScope="USERS">
      <MatCarousel2D slides={slides} />
    </MatShell>
  );
}