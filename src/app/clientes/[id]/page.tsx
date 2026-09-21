"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, ClipboardCheck, FileText, ShieldCheck } from "lucide-react";

import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { mergeModules, normalizeRole, isSuperAdmin } from "@/lib/roles";
import { getClientById, type ClientItem } from "@/services/clients";
import {
  getWhatsAppQrDashboard,
  saveWhatsAppDeliveryRoute,
} from "@/services/whatsappQr";
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

  const [whatsappChats, setWhatsappChats] = useState<
    Array<{
      id: string;
      name: string;
      isGroup: boolean;
    }>
  >([]);

  const [whatsappSelectedChatIds, setWhatsappSelectedChatIds] =
    useState<string[]>([]);

  const [whatsappRouteLoading, setWhatsappRouteLoading] =
    useState(false);

  const [whatsappRouteSaving, setWhatsappRouteSaving] =
    useState(false);

  const [whatsappRouteMessage, setWhatsappRouteMessage] =
    useState("");

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

  useEffect(() => {
    let alive = true;

    async function loadWhatsappRoute() {
      if (!clientId || !canManageWhatsappRoute) {
        setWhatsappChats([]);
        setWhatsappSelectedChatIds([]);
        return;
      }

      setWhatsappRouteLoading(true);
      setWhatsappRouteMessage("");

      try {
        const dashboard = await getWhatsAppQrDashboard();

        if (!alive) return;

        const chats = (dashboard.chats || []).map((chat: any) => ({
          id: String(chat.id || chat.safeDocId || ""),
          name: String(chat.name || chat.chatId || "WhatsApp"),
          isGroup: chat.isGroup === true,
        }));

        setWhatsappChats(
          chats.filter((chat) => !!chat.id)
        );

        const route = (dashboard.routes || []).find(
          (item: any) =>
            item.active !== false &&
            String(item.clienteId || "").trim() === clientId &&
            String(item.sourceType || "DEFAULT")
              .trim()
              .toUpperCase() === "DEFAULT"
        );

        const selected = Array.isArray(route?.destinationChats)
          ? route.destinationChats
              .map((item: any) =>
                String(
                  item.safeDocId ||
                  item.id ||
                  ""
                ).trim()
              )
              .filter(Boolean)
          : [];

        setWhatsappSelectedChatIds(
          Array.from(new Set(selected))
        );
      } catch (e: any) {
        if (!alive) return;

        setWhatsappChats([]);
        setWhatsappSelectedChatIds([]);

        setWhatsappRouteMessage(
          e?.message ||
            "No se pudo cargar la configuracion WhatsApp."
        );
      } finally {
        if (alive) {
          setWhatsappRouteLoading(false);
        }
      }
    }

    loadWhatsappRoute();

    return () => {
      alive = false;
    };
  }, [clientId, canManageWhatsappRoute]);

  function toggleWhatsappChat(chatId: string) {
    setWhatsappSelectedChatIds((current) =>
      current.includes(chatId)
        ? current.filter((id) => id !== chatId)
        : [...current, chatId]
    );
  }

  async function saveWhatsappDefaultRoute() {
    if (!clientId || whatsappSelectedChatIds.length === 0) {
      setWhatsappRouteMessage(
        "Selecciona al menos un destino WhatsApp."
      );
      return;
    }

    setWhatsappRouteSaving(true);
    setWhatsappRouteMessage("");

    try {
      const result = await saveWhatsAppDeliveryRoute({
        clienteId: clientId,
        sourceType: "DEFAULT",
        chatDocIds: whatsappSelectedChatIds,
      });

      setWhatsappRouteMessage(
        result.message ||
          "Destino WhatsApp guardado."
      );
    } catch (e: any) {
      setWhatsappRouteMessage(
        e?.message ||
          "No se pudo guardar el destino WhatsApp."
      );
    } finally {
      setWhatsappRouteSaving(false);
    }
  }
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
              Costos
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

          {canManageWhatsappRoute && (
            <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.05] p-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-emerald-100">
                  Destino WhatsApp
                </h3>

                <p className="text-xs text-slate-400">
                  Destino general para las comunicaciones WhatsApp de este cliente.
                </p>
              </div>

              {whatsappRouteLoading ? (
                <div className="mt-4 text-sm text-slate-400">
                  Cargando chats WhatsApp...
                </div>
              ) : whatsappChats.length === 0 ? (
                <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">
                  No hay chats WhatsApp sincronizados disponibles.
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {whatsappChats.map((chat) => {
                    const checked =
                      whatsappSelectedChatIds.includes(chat.id);

                    return (
                      <label
                        key={chat.id}
                        className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 transition hover:bg-white/[0.05]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            toggleWhatsappChat(chat.id)
                          }
                          className="h-4 w-4"
                        />

                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-slate-100">
                            {chat.name}
                          </div>

                          <div className="text-[11px] text-slate-500">
                            {chat.isGroup
                              ? "Grupo WhatsApp"
                              : "Contacto WhatsApp"}
                          </div>
                        </div>
                      </label>
                    );
                  })}

                  <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={saveWhatsappDefaultRoute}
                      disabled={
                        whatsappRouteSaving ||
                        whatsappSelectedChatIds.length === 0
                      }
                      className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {whatsappRouteSaving
                        ? "Guardando..."
                        : "Guardar destino WhatsApp"}
                    </button>

                    <span className="text-xs text-slate-400">
                      {whatsappSelectedChatIds.length} destino(s) seleccionado(s)
                    </span>
                  </div>
                </div>
              )}

              {whatsappRouteMessage && (
                <div className="mt-3 text-xs text-slate-300">
                  {whatsappRouteMessage}
                </div>
              )}
            </div>
          )}
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
