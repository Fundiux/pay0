"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, ClipboardCheck, FileText, ShieldCheck } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { mergeModules, normalizeRole, isSuperAdmin } from "@/lib/roles";
import { getClientById, type ClientItem } from "@/services/clients";
import ClientWhatsAppGroupPicker from "@/components/whatsapp/ClientWhatsAppGroupPicker";
import ClientEntityDocumentsPanel from "@/components/ClientEntityDocumentsPanel";

type DetailTab = "resumen" | "expediente" | "papeleria" | "kyc";

function getEffectiveRootId(profile: any, uid?: string) {
  return String(profile?.rootId || uid || "");
}

function infoValue(value: any) {
  const text = String(value || "").trim();
  return text || "---";
}

function formatClientFolio(client: ClientItem) {
  const number = Number(
    client.numeroCliente ?? client.clientNumber ?? 0
  );
  if (!Number.isFinite(number) || number <= 0) return "Sin folio";
  return `C${String(number).padStart(2, "0")}`;
}

function formatStatus(active?: boolean) {
  return active === false ? "Inactivo" : "Activo";
}

export default function ClienteDetallePage() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const { profile, loading } = useUserProfile();

  const uid = (user as any)?.uid as string | undefined;
  const clientId = String(params?.id || "");
  const effectiveRootId = useMemo(() => getEffectiveRootId(profile, uid), [profile, uid]);

  const modules = useMemo(
    () => mergeModules((profile as any)?.role, (profile as any)?.modules),
    [profile]
  );

  const canViewClientes = !!modules?.clientes?.view;
  const canCostsClientes = !!modules?.clientes?.costs;
  const canManageEntityDocuments = isSuperAdmin(normalizeRole((profile as any)?.role));
  const canManageWhatsappRoute = isSuperAdmin(normalizeRole((profile as any)?.role));

  const [client, setClient] = useState<ClientItem | null>(null);
  const [tab, setTab] = useState<DetailTab>("resumen");
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");


  useEffect(() => {
    let alive = true;

    async function load() {
      if (!clientId || !uid || !effectiveRootId || !canViewClientes) {
        setClient(null);
        setBusy(false);
        return;
      }

      setBusy(true);
      setErr("");

      try {
        const item = await getClientById(clientId, effectiveRootId);

        if (!alive) return;

        if (!item) {
          setClient(null);
          setErr("Cliente no encontrado o sin acceso.");
          return;
        }

        setClient(item);
      } catch (e: any) {
        if (!alive) return;
        setClient(null);
        setErr(e?.message || "No se pudo cargar el cliente.");
      } finally {
        if (alive) setBusy(false);
      }
    }

    load();

    return () => {
      alive = false;
    };
  }, [clientId, uid, effectiveRootId, canViewClientes]);

  if (loading || busy) {
    return (
      <div className="w-full max-w-none px-4 py-6 text-slate-300">
        Cargando cliente...
      </div>
    );
  }

  if (!canViewClientes) {
    return (
      <div className="w-full max-w-none px-4 py-6">
        <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-5 text-sm text-slate-300">
          No tienes permiso para ver clientes.
        </div>
      </div>
    );
  }

  if (err || !client) {
    return (
      <div className="w-full max-w-none px-4 py-6">
        <Link href="/clientes" className="inline-flex items-center gap-2 text-sm text-sky-300 hover:text-sky-200">
          <ArrowLeft size={16} />
          Regresar a Clientes
        </Link>

        <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-5 text-sm text-rose-100">
          {err || "Cliente no encontrado."}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none px-4 py-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <Link href="/clientes" className="mb-3 inline-flex items-center gap-2 text-sm text-sky-300 hover:text-sky-200">
            <ArrowLeft size={16} />
            Regresar a Clientes
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
            {client.name || "Cliente"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Catalogos / Clientes / Detalle
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCostsClientes && (
            <Link
              href={`/clientes/${client.id}/costos`}
              className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/15"
            >
              Costos y distribución
            </Link>
          )}

          <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
            {formatStatus(client.active)}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <Building2 size={16} />
            Cliente
          </div>
          <div className="mt-3 space-y-2 text-sm text-slate-400">
            <p>RFC: <span className="text-slate-200">{infoValue(client.rfc)}</span></p>
            <p>Email: <span className="text-slate-200">{infoValue(client.email)}</span></p>
            <p>WhatsApp: <span className="text-slate-200">{infoValue((client as any).whatsapp || (client as any).phone)}</span></p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <ClipboardCheck size={16} />
            Operacion
          </div>
          <div className="mt-3 space-y-2 text-sm text-slate-400">
            <p>Folio: <span className="text-slate-200">{formatClientFolio(client)}</span></p>
            <p>Cliente: <span className="text-slate-200">{infoValue(client.name)}</span></p>
            <p>Estado: <span className="text-slate-200">{formatStatus(client.active)}</span></p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <FileText size={16} />
            Expediente
          </div>
          <div className="mt-3 space-y-2 text-sm text-slate-400">
            <p>Ubicacion: <span className="text-slate-200">Cliente + Empresa PAY0</span></p>
            <p>Armado: <span className="text-slate-200">Automatico</span></p>
            <p>Estado: <span className="text-amber-200">Base pendiente</span></p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#161d2b] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
            <ShieldCheck size={16} />
            KYC / Riesgo
          </div>
          <div className="mt-3 space-y-2 text-sm text-slate-400">
            <p>KYC base: <span className="text-amber-200">Pendiente</span></p>
            <p>Logica operativa: <span className="text-amber-200">Pendiente</span></p>
            <p>Alertas: <span className="text-slate-200">Sin evaluar</span></p>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-[#161d2b] p-2">
        <div className="flex flex-wrap gap-2">
          {[
            ["resumen", "Resumen"],
            ["expediente", "Expediente"],
            ["papeleria", "Papeleria fiscal"],
            ["kyc", "KYC / Analisis"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key as DetailTab)}
              className={`rounded-xl px-4 py-2 text-sm transition ${
                tab === key
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "resumen" && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-[#161d2b] p-5">
          <h2 className="text-lg font-semibold text-slate-50">Resumen del cliente</h2>
          <p className="mt-2 text-sm text-slate-400">
            Vista base del cliente. Desde aqui se centralizara el expediente fiscal-operativo,
            contratos, KYC, operaciones y documentos relacionados.
          </p>

          {canManageWhatsappRoute && clientId && <ClientWhatsAppGroupPicker clientId={clientId} />}
        </div>
      )}

      {tab === "expediente" && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-[#161d2b] p-5">
          <h2 className="text-lg font-semibold text-slate-50">Expediente de Materialidad</h2>
          <p className="mt-2 text-sm text-slate-400">
            El expediente se debe armar automaticamente por Cliente + Empresa PAY0. Solicitudes,
            pagos, contratos, documentos, Activity Log y KYC alimentaran esta vista.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-medium text-slate-100">Contratos</p>
              <p className="mt-1 text-xs text-slate-400">Contrato marco por Cliente + Empresa PAY0.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-medium text-slate-100">Operaciones</p>
              <p className="mt-1 text-xs text-slate-400">Solicitudes, OC, presupuestos, facturas y pagos asociados.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-sm font-medium text-slate-100">Auditoria</p>
              <p className="mt-1 text-xs text-slate-400">Metadata, hash, sello interno, trazabilidad y QR/token verificable.</p>
            </div>
          </div>
        </div>
      )}


      {tab === "papeleria" && (
        <ClientEntityDocumentsPanel
          clientId={client.id}
          canManage={canManageEntityDocuments}
        />
      )}
      {tab === "kyc" && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-[#161d2b] p-5">
          <h2 className="text-lg font-semibold text-slate-50">KYC / Analisis logico</h2>
          <p className="mt-2 text-sm text-slate-400">
            Esta seccion concentrara KYC base, analisis de congruencia de operaciones,
            inconsistencias, riesgos y faltantes de soporte tipo auditoria SAT.
          </p>
        </div>
      )}
    </div>
  );
}
