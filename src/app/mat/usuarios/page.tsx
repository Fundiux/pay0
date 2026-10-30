"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import NuevaSolicitudModal from "@/components/NuevaSolicitudModal";
import PagoDocsModal from "@/components/PagoDocsModal";
import DispersionDocsModal from "@/components/DispersionDocsModal";
import { GlobalLoadingProvider } from "@/components/GlobalLoading";
import { MatSolicitudDocuments } from "@/components/mat/MatSolicitudDocuments";
import { MatOperationForm } from "@/components/mat/MatOperationForm";

import { MatHomeOverview } from "@/components/mat/MatHomeOverview";
import { MatCarousel2D, type MatCarouselSlide } from "@/components/mat/MatCarousel2D";
import { MatShell } from "@/components/mat/MatShell";
import { useMatUserHome } from "@/components/mat/useMatHome";
import type { MatHomeItem, MatHomeMetric } from "@/services/telegramMiniApp";
import { listPagos } from "@/services/pagos";

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

function OperationList({
  title,
  items,
  empty,
  onSelect,
  actionText = "Ver documentos",
}: {
  title: string;
  items: MatHomeItem[];
  empty: string;
  onSelect?: (item: MatHomeItem) => void;
  actionText?: string;
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
          {onSelect ? <button type="button" onClick={() => onSelect(item)} className="w-full text-left" aria-label={`${actionText} de ${item.title}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-white">{item.title}</div>
              <div className="mt-1 truncate text-xs text-slate-500">{getItemCaption(item)}</div>
              <div className="mt-2 text-[11px] font-semibold text-cyan-300">{actionText} ›</div>
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

function MatAction({ label, href, onClick, note }: { label: string; href?: string; onClick?: () => void; note: string }) {
  const className = "block w-full rounded-2xl bg-cyan-300 px-4 py-3 text-center text-sm font-black text-slate-950 active:scale-[0.99]";
  return (
    <div className="space-y-2">
      {onClick ? <button type="button" onClick={onClick} className={className}>{label}</button> : <a href={href} className={className}>{label}</a>}
      <p className="px-1 text-xs leading-5 text-slate-400">{note}</p>
    </div>
  );
}

export default function MatUsuariosPage() {
  const { home, loading, error } = useMatUserHome();
  const { user } = useAuth();
  const [newSolicitudOpen, setNewSolicitudOpen] = useState(false);
  const [selectDispersionClient, setSelectDispersionClient] = useState(false);
  const [dispersionClientId, setDispersionClientId] = useState("");
  const [dispersionClientSearch, setDispersionClientSearch] = useState("");
  const [operationForm, setOperationForm] = useState<"pago" | "dispersion" | null>(null);
  const [docsSolicitud, setDocsSolicitud] = useState<MatHomeItem | null>(null);
  const [docsPago, setDocsPago] = useState<MatHomeItem | null>(null);
  const [docsDispersion, setDocsDispersion] = useState<MatHomeItem | null>(null);
  const hasMatchingSession = Boolean(home?.linked && user?.uid && user.uid === home.pay0UserId);
  const [registeredPagos, setRegisteredPagos] = useState<MatHomeItem[]>([]);
  const [pagosLoading, setPagosLoading] = useState(false);
  const [pagosError, setPagosError] = useState("");
  const loadRegisteredPagos = useCallback(async () => {
    if (!hasMatchingSession) return;
    setPagosLoading(true);
    setPagosError("");
    try {
      const result = await listPagos({ limit: 20 });
      setRegisteredPagos(result.items.map((pago) => ({
        id: String(pago.id),
        title: String(pago.clienteNombre || pago.clientName || "Cliente"),
        caption: `${String(pago.folio || pago.id)} · ${String(pago.empresaNombre || pago.companyName || "Pago registrado")}`,
        amount: formatMoney(Number(pago.montoTotal ?? pago.monto ?? pago.amount ?? 0)),
        status: String(pago.status || pago.estado || "REGISTRADO"),
        tone: "info" as const,
        createdAtMillis: Number(pago.createdAt?.seconds || 0) * 1000,
      })));
    } catch {
      setPagosError("No se pudieron cargar los pagos registrados.");
    } finally {
      setPagosLoading(false);
    }
  }, [hasMatchingSession, user?.uid, home?.pay0UserId]);
  useEffect(() => { void loadRegisteredPagos(); }, [loadRegisteredPagos]);

  const solicitudes = home?.linked ? sortItems(home.solicitudes || []) : [];
  const dispersiones = home?.linked ? sortItems(home.dispersiones || []) : [];
  const movimientos = home?.linked ? sortItems(home.movements || []) : [];
  const pagosFromMovements = movimientos.filter((item) => /pago|payment|abono/i.test(`${item.title} ${item.status} ${getItemCaption(item)}`));
  const pagos = hasMatchingSession
    ? [...registeredPagos].sort((a, b) => b.createdAtMillis - a.createdAtMillis)
    : home?.linked ? sortItems(pagosFromMovements) : [];
  const metrics: MatHomeMetric[] = [
    { label: "Solicitudes", value: String(solicitudes.length) },
    { label: "Pagos", value: String(pagos.length) },
    { label: "Dispersiones", value: String(dispersiones.length) },
  ];

  const amount = home?.linked ? formatMoney(home.balance?.availableBalance || 0) : "$0.00";
  const identityLabel = home?.displayName || (home as any)?.username || "Usuario";
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
            metrics={metrics}
            sections={[
              { label: "Solicitudes", metric: "Solicitudes", target: "solicitudes", detail: "Folios recientes y captura" },
              { label: "Pagos", metric: "Pagos", target: "pagos", detail: "Movimientos recientes de pago" },
              { label: "Dispersiones", metric: "Dispersiones", target: "dispersiones", detail: "Envíos y retornos recientes" },
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
      title: "Crear y revisar",
      description: "Crear solicitud con OC obligatoria y revisar folios.",
      icon: "S",
      actionLabel: "Nueva solicitud",
      children: (
        <div className="space-y-4">
          <MatAction label={hasMatchingSession ? "Nueva solicitud" : "Abrir solicitudes en PAY0"} href="/solicitudes" onClick={hasMatchingSession ? () => setNewSolicitudOpen(true) : undefined} note={hasMatchingSession ? "Captura con tu sesión PAY0 vigente." : "La captura requiere iniciar sesión en PAY0."} />
          <OperationList title="Solicitudes recientes" items={solicitudes} empty="Aun no hay solicitudes visibles para esta cuenta." onSelect={setDocsSolicitud} />
        </div>
      ),
    },
    {
      id: "pagos",
      eyebrow: "Pagos",
      title: "Pagos registrados",
      description: "Consulta tus pagos y registra uno nuevo con su comprobante.",
      icon: "P",
      actionLabel: "Subir pago",
      children: (
        <div className="space-y-4">
          <MatAction label={hasMatchingSession ? "Nuevo pago" : "Abrir pagos en PAY0"} href="/pagos" onClick={hasMatchingSession ? () => setOperationForm("pago") : undefined} note={hasMatchingSession ? "Captura el pago sin salir de la MAT." : "La captura requiere iniciar sesión en PAY0."} />
          {hasMatchingSession && pagosError ? <p role="alert" className="text-sm text-rose-300">{pagosError}</p> : pagosLoading ? <p className="text-sm text-slate-400">Cargando pagos...</p> : <OperationList title="Pagos recientes" items={pagos} empty={hasMatchingSession ? "Aún no hay pagos registrados visibles para esta cuenta." : "Aún no hay pagos visibles en los movimientos de esta cuenta."} onSelect={hasMatchingSession ? setDocsPago : undefined} actionText="Ver comprobante" />}
        </div>
      ),
    },
    {
      id: "dispersiones",
      eyebrow: "Dispersiones",
      title: "Enviar fondos",
      description: "Solicitar retorno mediante el flujo de dispersiones de PAY0 web.",
      icon: "D",
      actionLabel: "Solicitar retorno",
      children: (
        <div className="space-y-4">
          <MatAction label={hasMatchingSession ? "Nueva dispersión" : "Abrir dispersiones en PAY0"} href="/wallet/dispersiones" onClick={hasMatchingSession ? () => setSelectDispersionClient(true) : undefined} note="Selecciona un cliente; la dispersión requiere una sesión PAY0 autorizada." />
          <OperationList title="Dispersiones recientes" items={dispersiones} empty="Aun no hay dispersiones visibles para esta cuenta." onSelect={hasMatchingSession ? setDocsDispersion : undefined} actionText="Ver comprobante" />
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
    <GlobalLoadingProvider><MatShell title="Usuarios" identityLabel={identityLabel} loading={loading} activeNav="inicio" navItems={navItems}>
      <MatCarousel2D slides={slides} />
      {hasMatchingSession && <NuevaSolicitudModal open={newSolicitudOpen} onClose={() => setNewSolicitudOpen(false)} variant="mat" />}
      {docsSolicitud && <MatSolicitudDocuments solicitudId={docsSolicitud.id} folio={docsSolicitud.caption.split(" · ")[0]} scope="USERS" onClose={() => setDocsSolicitud(null)} />}
      {docsPago && <PagoDocsModal open pago={{ id: docsPago.id }} onClose={() => setDocsPago(null)} />}
      <DispersionDocsModal open={Boolean(docsDispersion)} dispersion={docsDispersion ? { id: docsDispersion.id, rootId: home?.rootId, folio: docsDispersion.caption.split(" · ")[0], beneficiaryNombre: docsDispersion.title } : null} onClose={() => setDocsDispersion(null)} />
      {selectDispersionClient && <div role="dialog" aria-modal="true" aria-label="Seleccionar cliente para dispersión" className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
        <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-[#161d2b] p-5">
          <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-black text-white">Selecciona cliente</h2><button type="button" onClick={() => setSelectDispersionClient(false)} aria-label="Cerrar" className="rounded-full bg-slate-950 px-3 py-1 text-slate-300">×</button></div>
          <label htmlFor="mat-dispersion-client-search" className="mb-2 block text-sm text-slate-300">Cliente</label>
          <input id="mat-dispersion-client-search" type="search" value={dispersionClientSearch} onChange={(event) => setDispersionClientSearch(event.target.value)} placeholder="Buscar cliente" className="w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-cyan-300" />
          <div role="listbox" aria-label="Clientes disponibles" className="mt-3 max-h-[min(44dvh,320px)] space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-slate-950/60 p-2 touch-pan-y">
            {(home?.clients || []).filter((client) => client.title.toLocaleLowerCase("es").includes(dispersionClientSearch.trim().toLocaleLowerCase("es"))).map((client) => <button key={client.id} type="button" role="option" aria-selected={dispersionClientId === client.id} onClick={() => setDispersionClientId(client.id)} className={`block w-full rounded-lg px-3 py-3 text-left text-sm ${dispersionClientId === client.id ? "bg-cyan-300 text-slate-950" : "text-white hover:bg-white/10"}`}>{client.title}</button>)}
          </div>
          <p className="mt-2 text-xs text-slate-400">{(home?.clients || []).length} clientes disponibles</p>
          <button type="button" disabled={!dispersionClientId} onClick={() => { setSelectDispersionClient(false); setOperationForm("dispersion"); }} className="mt-4 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-40">Continuar</button>
        </div>
      </div>}
      {hasMatchingSession && operationForm && <MatOperationForm kind={operationForm} clientId={dispersionClientId} onClose={() => { if (operationForm === "pago") void loadRegisteredPagos(); setOperationForm(null); }} />}
    </MatShell></GlobalLoadingProvider>
  );
}
