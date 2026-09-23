"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole, isSuperAdmin, isAdmin, isOperador, mergeModules } from "@/lib/roles";
import { ChevronUp, ChevronDown, RefreshCw, CircleDollarSign, Send, Pencil, Power, PowerOff, Eye, UploadCloud, FileText } from "lucide-react";
import { repairClientNumbersByAdminMutation as repairClientNumbersByAdmin, saveClientMutation as saveClient, syncIqClientMutation as syncIqClient, toggleClientActiveMutation as toggleClientActive } from "@/services/clientMutations";
import { listScopedClients } from "@/services/clients";
import {
  finalizeClientCsfIntake,
  parseClientCsfFile,
  type ClientCsfIntakeResult,
} from "@/services/clientCsf";
import { uploadEntityDocument } from "@/lib/uploadEntityDocument";
import {
  createClientTelegramLinkToken,
  getClientTelegramLinkStatus,
  unlinkClientTelegramAccount,
  type ClientTelegramLinkStatusResult,
} from "@/services/telegram";

type ClientRow = {
  id: string;
  name: string;
  numeroCliente?: number;
  clientNumber?: number;
  rfc?: string;
  email?: string;
  whatsapp?: string;
  active?: boolean;
  rootId?: string;
  adminId?: string;
  ownerId?: string;
  managedByUserId?: string;
  
  createdByName?: string;
  createdByUsername?: string;
  ownerName?: string;
  ownerUsername?: string;
  managedByUserName?: string;
  managedByUsername?: string;createdAt?: any;
  updatedAt?: any;
  iqLink?: {
    status?: string;
    clientId?: string;
    clientName?: string;
    partnerId?: string;
    partnerName?: string;
    source?: string;
    reviewReason?: string;
    candidates?: Array<{
      clientId?: string;
      clientName?: string;
      rfc?: string;
    }>;
  } | null;
  iqClientId?: string;
  iqClientName?: string;
};

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}


function actionIconClass(kind: "detail" | "costos" | "telegram" | "edit" | "on" | "off") {
  const base = "inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:opacity-40";
  const map: Record<string, string> = {
    detail: "hover:text-sky-300",
    costos: "hover:text-emerald-400",
    telegram: "hover:text-sky-400",
    edit: "hover:text-yellow-400",
    on: "hover:text-emerald-400",
    off: "hover:text-rose-500",
  };

  return `${base} ${map[kind] || ""}`;
}

function getClientUsuarioLabel(it: ClientRow) {
  return String(
    it.createdByUsername ||
    it.createdByName ||
    it.ownerUsername ||
    it.ownerName ||
    it.managedByUsername ||
    it.managedByUserName ||
    ""
  ).trim() || "---";
}
function getEffectiveRootId(profile: any, uid?: string) {
  return String(profile?.rootId || uid || "");
}

function getEffectiveAdminId(profile: any, uid?: string) {
  const role = normalizeRole(profile?.role);
  const parentUserId = String(profile?.parentUserId || "");

  if (!uid) return "";
  if (isSuperAdmin(role)) return uid;
  if (isAdmin(role)) return uid;
  return parentUserId || uid;
}

export default function ClientesPage() {
  const { user } = useAuth();
  const { profile, loading } = useUserProfile();

  const uid = (user as any)?.uid as string | undefined;
  const role = normalizeRole((profile as any)?.role);
  const effectiveRootId = useMemo(() => getEffectiveRootId(profile, uid), [profile, uid]);
  const adminId = useMemo(() => getEffectiveAdminId(profile, uid), [profile, uid]);

  const modules = useMemo(
    () => mergeModules((profile as any)?.role, (profile as any)?.modules),
    [profile]
  );

  const canViewClientes = !!modules?.clientes?.view;
  const canCreateClientes = !!modules?.clientes?.create;
  const canEditClientes = !!modules?.clientes?.edit;
  const canCostsClientes = !!modules?.clientes?.costs;

  const isadmin = isAdmin(role);
  const isoperador = isOperador(role);

  const [items, setItems] = useState<ClientRow[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);

  const [name, setName] = useState("");
  const [rfc, setRfc] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const csfInputRef = useRef<HTMLInputElement | null>(null);
  const [csfFile, setCsfFile] = useState<File | null>(null);
  const [csfIntake, setCsfIntake] = useState<ClientCsfIntakeResult | null>(null);
  const [csfBusy, setCsfBusy] = useState(false);
  const [csfProgress, setCsfProgress] = useState<number | null>(null);
  const [isCsfPageDragging, setIsCsfPageDragging] = useState(false);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [isRepairing, setIsRepairing] = useState(false);
  const [toggleBusyId, setToggleBusyId] = useState<string>("");
  const [iqBusyId, setIqBusyId] = useState<string>("");
  const [pageMsg, setPageMsg] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [telegramClient, setTelegramClient] = useState<ClientRow | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<ClientTelegramLinkStatusResult | null>(null);
  const [telegramStartUrl, setTelegramStartUrl] = useState("");
  const [telegramExpiresAt, setTelegramExpiresAt] = useState("");
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [telegramMsg, setTelegramMsg] = useState("");

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>({ key: "name", direction: "asc" });

  useEffect(() => {
    if (!canViewClientes || !uid || !effectiveRootId) {
      setItems([]);
      return;
    }

    return listScopedClients(
      { uid, role, rootId: effectiveRootId },
      (rows) => setItems(rows as ClientRow[]),
      (e) => console.warn("[clients] scoped snapshot:", (e as any)?.code || (e as any)?.message || e)
    );
  }, [effectiveRootId, uid, role, canViewClientes]);

  const sortedItems = useMemo(() => {
    let sortableItems = [...items];
    if (sortConfig !== null) {
      sortableItems.sort((a: any, b: any) => {
        let valA = a[sortConfig.key] || "";
        let valB = b[sortConfig.key] || "";

        if (typeof valA === "string") valA = valA.toLowerCase();
        if (typeof valB === "string") valB = valB.toLowerCase();

        if (valA < valB) return sortConfig.direction === "asc" ? -1 : 1;
        if (valA > valB) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [items, sortConfig]);

  const requestSort = (key: string) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  function requestRepairClientNumbers() {
    if (!adminId || isRepairing) return;

    setConfirmAction({
      title: "Reparar C00",
      message: "Esto asignara numeros correlativos a todos los clientes que no lo tengan. Continuar?",
      confirmLabel: "Reparar",
      onConfirm: repairClientNumbers,
    });
  }

  async function repairClientNumbers() {
    if (!adminId || isRepairing) return;

    setPageMsg("");
    setIsRepairing(true);
    try {
      await repairClientNumbersByAdmin(adminId);
      setPageMsg("Numeros de cliente actualizados correctamente.");
    } catch (e: any) {
      setPageMsg(e?.message ? `Error al reparar numeros: ${e.message}` : "Error al reparar numeros.");
    } finally {
      setIsRepairing(false);
    }
  }

  const canSave = useMemo(() => {
    if (loading) return false;
    if (!uid || !effectiveRootId || !adminId) return false;
    if (saving) return false;
    return name.trim().length >= 2;
  }, [loading, uid, effectiveRootId, adminId, saving, name]);

  function resetCsfState() {
    setCsfFile(null);
    setCsfIntake(null);
    setCsfBusy(false);
    setCsfProgress(null);
    if(csfInputRef.current) csfInputRef.current.value = "";
  }

  function openCreate() {
    if (!canCreateClientes) return;
    setEditing(null);
    setName("");
    setRfc("");
    setEmail("");
    setWhatsapp("");
    resetCsfState();
    setErr(null);
    setOpen(true);
  }

  useEffect(() => {
    if (!canCreateClientes) return;
    const handleCreate = () => openCreate();
    window.addEventListener("pay0:create-client", handleCreate);
    return () => window.removeEventListener("pay0:create-client", handleCreate);
  }, [canCreateClientes]);

  function openEdit(it: ClientRow) {
    if (!canEditClientes) return;
    setEditing(it);
    setName(it.name || "");
    setRfc(it.rfc || "");
    setEmail(it.email || "");
    setWhatsapp(it.whatsapp || "");
    resetCsfState();
    setErr(null);
    setOpen(true);
  }

  useEffect(() => {
    function hasFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types || []).includes("Files");
    }

    function isClientCsfFile(file: File) {
      return file.name.toLowerCase().endsWith(".pdf");
    }

    function handleWindowDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      if (open || csfBusy || saving) return;

      event.preventDefault();
      setIsCsfPageDragging(true);
    }

    function handleWindowDragLeave(event: DragEvent) {
      if (
        event.clientX <= 0 ||
        event.clientY <= 0 ||
        event.clientX >= window.innerWidth ||
        event.clientY >= window.innerHeight
      ) {
        setIsCsfPageDragging(false);
      }
    }

    function handleWindowDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      if (open || csfBusy || saving) return;

      event.preventDefault();
      setIsCsfPageDragging(false);

      const files = Array.from(event.dataTransfer?.files || []);
      const sourceFiles = files.filter(isClientCsfFile);

      if (sourceFiles.length === 0) {
        setPageMsg("Solo se permite Constancia de Situacion Fiscal en PDF.");
        return;
      }

      const file = sourceFiles[0];
      void onCsfFile(file);
    }

    window.addEventListener("dragover", handleWindowDragOver, true);
    window.addEventListener("dragleave", handleWindowDragLeave, true);
    window.addEventListener("drop", handleWindowDrop, true);

    return () => {
      window.removeEventListener("dragover", handleWindowDragOver, true);
      window.removeEventListener("dragleave", handleWindowDragLeave, true);
      window.removeEventListener("drop", handleWindowDrop, true);
    };
  }, [open, csfBusy, saving]);

  async function onCsfFile(file: File | null) {
    if(!file || csfBusy || saving) return;
    setCsfBusy(true);
    setIsCsfPageDragging(false);
    setErr(null);
    setPageMsg("Leyendo Constancia de Situacion Fiscal...");
    setCsfProgress(null);

    try{
      const result = await parseClientCsfFile(file);
      setCsfFile(file);
      setCsfIntake(result);
      setEditing(null);
      setName(result.parsed.razonSocial || "");
      setRfc(result.parsed.rfc || "");
      setEmail("");
      setWhatsapp("");
      setIsCsfPageDragging(false);
      setPageMsg("");
      setOpen(true);
    }catch(e:any){
      const message = e?.message || "No se pudo leer la Constancia de Situacion Fiscal.";
      setCsfFile(null);
      setCsfIntake(null);
      setErr(message);
      setPageMsg(message);
      setIsCsfPageDragging(false);
    }finally{
      setCsfBusy(false);
    }
  }

  async function onSave() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);

    try {
      const saved: any = await saveClient({
        editingId: editing?.id || null,
        effectiveRootId,
        adminId,
        uid: uid!,
        managedByUserId: editing?.managedByUserId || uid,
        name,
        rfc,
        email,
        whatsapp,
        csfIntakeId: csfIntake?.intakeId || null,
      });

      const clientId = String(saved?.id || editing?.id || "").trim();
      let csfMessage = "";

      if(csfFile && csfIntake?.intakeId && clientId){
        if(!editing){
          setEditing({
            id:clientId,
            name,
            rfc,
            email,
            whatsapp,
          } as ClientRow);
        }

        const parsed=csfIntake.parsed;
        const legalPersonType =
          String(parsed.rfc || "").trim().length === 12
            ? "PERSONA_MORAL"
            : "PERSONA_FISICA";

        const uploaded = await uploadEntityDocument({
          entityType:"CLIENTE",
          entityId:clientId,
          documentType:"CONSTANCIA_SITUACION_FISCAL",
          legalPersonType,
          fiscalAdminType:"SOLO_OPERATIVO",
          file:csfFile,
          periodYear:parsed.periodYear || new Date().getFullYear(),
          periodMonth:parsed.periodMonth || (new Date().getMonth()+1),
          notes:"CSF cargada desde alta de cliente",
          onProgress:value=>setCsfProgress(value.progress),
        });

        await finalizeClientCsfIntake({
          intakeId:csfIntake.intakeId,
          clientId,
          entityDocumentId:uploaded.entityDocumentId,
        });

        csfMessage = "CSF guardada y RFC enviado a KYC.";
      }

      const messages=[
        csfMessage,
        saved?.iqSync?.message || "",
      ].filter(Boolean);

      if(messages.length){
        setPageMsg(messages.join(" "));
      }

      resetCsfState();
      setOpen(false);
      setEditing(null);
    } catch (e: any) {
      setErr(e?.message || "Error al guardar cliente.");
    } finally {
      setSaving(false);
    }
  }

  async function onSyncIq(it: ClientRow) {
    if(iqBusyId === it.id) return;
    setIqBusyId(it.id);
    setPageMsg("");

    try{
      const result: any = await syncIqClient(it.id);
      setPageMsg(
        result?.message ||
        "Sincronizacion IQ terminada.",
      );
    }catch(e:any){
      setPageMsg(
        e?.message ||
        "No se pudo sincronizar cliente con IQ.",
      );
    }finally{
      setIqBusyId("");
    }
  }

  async function onToggleActive(id: string, nextActive: boolean) {
    if (toggleBusyId === id) return;

    setPageMsg("");
    setToggleBusyId(id);
    try {
      await toggleClientActive(id, nextActive);
    } catch (e: any) {
      setPageMsg(e?.message || "No se pudo actualizar cliente.");
    } finally {
      setToggleBusyId("");
    }
  }


  async function refreshClientTelegramStatus(clientId?: string) {
    const targetId = String(clientId || telegramClient?.id || "").trim();

    if (!targetId) return null;

    setTelegramBusy(true);
    setTelegramMsg("");

    try {
      const status = await getClientTelegramLinkStatus(targetId);
      setTelegramStatus(status);
      return status;
    } catch (e: any) {
      setTelegramMsg(e?.message || "No se pudo consultar Telegram del cliente.");
      return null;
    } finally {
      setTelegramBusy(false);
    }
  }

  async function openClientTelegram(it: ClientRow) {
    setTelegramClient(it);
    setTelegramStatus(null);
    setTelegramStartUrl("");
    setTelegramExpiresAt("");
    setTelegramMsg("");
    await refreshClientTelegramStatus(it.id);
  }

  async function generateClientTelegramLink() {
    if (!telegramClient?.id) return;

    setTelegramBusy(true);
    setTelegramMsg("");

    try {
      const res = await createClientTelegramLinkToken(telegramClient.id);
      setTelegramStartUrl(res.startUrl || "");
      setTelegramExpiresAt(res.expiresAt || "");
      setTelegramMsg("Enlace Telegram generado para el cliente.");
      await refreshClientTelegramStatus(telegramClient.id);
    } catch (e: any) {
      setTelegramMsg(e?.message || "No se pudo generar enlace Telegram.");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function copyClientTelegramLink() {
    if (!telegramStartUrl) return;

    try {
      await navigator.clipboard.writeText(telegramStartUrl);
      setTelegramMsg("Enlace copiado.");
    } catch {
      setTelegramMsg("No se pudo copiar automaticamente.");
    }
  }

  function requestUnlinkClientTelegram() {
    if (!telegramClient?.id || telegramBusy) return;

    setConfirmAction({
      title: "Desvincular Telegram",
      message: "Desvincular Telegram de este cliente?",
      confirmLabel: "Desvincular",
      danger: true,
      onConfirm: unlinkClientTelegram,
    });
  }

  async function unlinkClientTelegram() {
    if (!telegramClient?.id || telegramBusy) return;

    setTelegramBusy(true);
    setTelegramMsg("");

    try {
      await unlinkClientTelegramAccount(telegramClient.id);
      setTelegramStartUrl("");
      setTelegramExpiresAt("");
      setTelegramMsg("Telegram del cliente desvinculado.");
      await refreshClientTelegramStatus(telegramClient.id);
    } catch (e: any) {
      setTelegramMsg(e?.message || "No se pudo desvincular Telegram del cliente.");
    } finally {
      setTelegramBusy(false);
    }
  }
  async function runConfirmAction() {
    if (!confirmAction || confirmBusy) return;

    setConfirmBusy(true);
    try {
      await confirmAction.onConfirm();
      setConfirmAction(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  const SortIcon = ({ column }: { column: string }) => {
    if (sortConfig?.key !== column) return null;
    return sortConfig.direction === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  if (!canViewClientes) {
    return (
      <div className="p-6 text-slate-400">
        No tienes acceso a Clientes.
      </div>
    );
  }

  return (
    <div
      className="relative w-full min-w-0 p-3 text-white font-normal sm:p-4"
      onDragEnter={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (open || csfBusy || saving) return;
        setIsCsfPageDragging(true);
      }}
      onDragOver={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (open || csfBusy || saving) return;
        setIsCsfPageDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.defaultPrevented) return;
        const nextTarget = e.relatedTarget as Node | null;
        if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
          setIsCsfPageDragging(false);
        }
      }}
      onDrop={(e) => {
        if (e.defaultPrevented) return;
        e.preventDefault();
        setIsCsfPageDragging(false);

        if (open || csfBusy || saving) return;

        const files = Array.from(e.dataTransfer.files || []);
        const sourceFiles = files.filter((file) =>
          file.name.toLowerCase().endsWith(".pdf")
        );

        if (sourceFiles.length === 0) {
          setPageMsg("Solo se permite Constancia de Situacion Fiscal en PDF.");
          return;
        }

        void onCsfFile(sourceFiles[0]);
      }}
    >
      {isCsfPageDragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-2 border-dashed border-[#0063C4]/60 bg-[#0063C4]/10 p-6">
          <div className="rounded-2xl border border-[#0063C4]/50 bg-[#0b1220]/95 px-6 py-5 text-center shadow-2xl shadow-black/40">
            <div className="text-[14px] font-normal text-white">
              Suelta la Constancia de Situacion Fiscal aqui
            </div>
            <div className="mt-1 text-[12px] text-slate-400">
              PDF CSF
            </div>
          </div>
        </div>
      ) : null}

      {csfBusy && !open ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[#0063C4]/10 p-6">
          <div className="rounded-2xl border border-[#0063C4]/50 bg-[#0b1220]/95 px-6 py-5 text-center shadow-2xl shadow-black/40">
            <div className="text-[14px] font-normal text-white">
              Leyendo Constancia de Situacion Fiscal...
            </div>
            <div className="mt-1 text-[12px] text-slate-400">
              PAY0 esta extrayendo RFC y datos fiscales
            </div>
          </div>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 py-1">
        <div>
          <div className="text-slate-100 text-xl font-semibold">Clientes</div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={requestRepairClientNumbers}
            disabled={isRepairing}
            className="rounded-2xl px-4 py-2.5 font-semibold border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 flex items-center gap-2 transition-all"
          >
            <RefreshCw size={18} className={isRepairing ? "animate-spin" : ""} />
            {isRepairing ? "Actualizando..." : "Reparar C00"}
          </button>

        </div>
      </div>

      <div className="pay0-table-card mt-3">
        <div className="grid grid-cols-12 gap-2 border-b border-white/10 bg-white/5 px-3 py-2 text-[12px] font-normal uppercase tracking-widest text-slate-500">
          <div className="col-span-1 cursor-pointer flex items-center gap-1 hover:text-sky-400 transition-colors" onClick={() => requestSort("numeroCliente")}>
            ID <SortIcon column="numeroCliente" />
          </div>
          <div className="col-span-2 cursor-pointer flex items-center gap-1 hover:text-sky-400 transition-colors" onClick={() => requestSort("name")}>
            Cliente <SortIcon column="name" />
          </div>
          <div className="col-span-2">Usuario</div>
          <div className="col-span-1">IQ</div>
          <div className="col-span-1 cursor-pointer flex items-center gap-1 hover:text-sky-400 transition-colors" onClick={() => requestSort("rfc")}>
            RFC <SortIcon column="rfc" />
          </div>
          <div className="col-span-2">Email</div>
          <div className="col-span-1">WhatsApp</div>
          <div className="col-span-2 text-right">ACC.</div>
        </div>

        {sortedItems.length === 0 ? (
          <div className="pay0-empty-cell">No se encontraron clientes</div>
        ) : (
          sortedItems.map((it, index) => {
            const isActive = it.active !== false;
            return (
              <div key={it.id} className={`grid min-h-[38px] grid-cols-12 items-center gap-2 px-3 py-1.5 text-[13px] font-normal transition-colors ${index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}`}>
                <div className="col-span-1 flex items-center font-mono text-[13px] font-normal text-sky-400">
                  C{String((it.clientNumber ?? it.numeroCliente) || 0).padStart(2, "0")}
                </div>
                <div className="col-span-2 flex items-center font-normal text-slate-100">
                  {it.name} {!isActive && <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-tighter text-slate-500">Inactivo</span>}
                </div>
                <div className="col-span-2 flex items-center truncate text-[13px] font-normal text-slate-400">{getClientUsuarioLabel(it)}</div>
                <div className="col-span-1 flex items-center truncate text-[11px] font-normal">
                  {it.iqLink?.status === "LINKED" ? (
                    <span className="text-emerald-400" title={it.iqLink?.clientName || ""}>{it.iqLink?.clientId || it.iqClientId}</span>
                  ) : it.iqLink?.status === "REVIEW_REQUIRED" ? (
                    <button
                      type="button"
                      onClick={() => onSyncIq(it)}
                      disabled={iqBusyId === it.id}
                      className="text-amber-400 hover:text-amber-300 disabled:opacity-40"
                      title={it.iqLink?.reviewReason || "Requiere revision IQ"}
                    >
                      Revisar
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSyncIq(it)}
                      disabled={iqBusyId === it.id}
                      className="text-slate-400 hover:text-sky-300 disabled:opacity-40"
                      title={it.iqLink?.reviewReason || "Sincronizar con IQ"}
                    >
                      {iqBusyId === it.id ? "..." : (it.iqLink?.status || "Pend.")}
                    </button>
                  )}
                </div>
                <div className="col-span-1 flex items-center truncate text-[13px] font-normal text-slate-400">{it.rfc || "-"}</div>
                <div className="col-span-2 flex items-center truncate text-[13px] font-normal text-slate-400">{it.email || "-"}</div>
                <div className="col-span-1 flex items-center truncate text-[13px] font-normal text-slate-400">{it.whatsapp || "-"}</div>
                <div className="col-span-2 flex items-center justify-end gap-2 text-right flex-nowrap whitespace-nowrap">
                  <Link
                    href={`/clientes/${it.id}`}
                    className={actionIconClass("detail")}
                    title="Detalle"
                    aria-label="Detalle cliente"
                  >
                    <Eye size={16} />
                  </Link>

                  {canCostsClientes && (
                    <Link
                      href={`/clientes/${it.id}/costos`}
                      className={actionIconClass("costos")}
                      title="Costos"
                      aria-label="Costos"
                    >
                      <CircleDollarSign size={16} />
                    </Link>
                  )}

                  {canEditClientes && (
                    <button
                      onClick={() => openClientTelegram(it)}
                      className={actionIconClass("telegram")}
                      title="Telegram"
                      aria-label="Telegram"
                    >
                      <Send size={16} />
                    </button>
                  )}

                  {canEditClientes && (
                    <button
                      onClick={() => openEdit(it)}
                      className={actionIconClass("edit")}
                      title="Editar"
                      aria-label="Editar"
                    >
                      <Pencil size={16} />
                    </button>
                  )}

                  <button
                    onClick={() => onToggleActive(it.id, !isActive)}
                    disabled={toggleBusyId === it.id}
                    className={actionIconClass(isActive ? "off" : "on")}
                    title={isActive ? "Desactivar" : "Activar"}
                    aria-label={isActive ? "Desactivar" : "Activar"}
                  >
                    {isActive ? <PowerOff size={16} /> : <Power size={16} />}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

            {pageMsg && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          {pageMsg}
        </div>
      )}
      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#161d2b] shadow-2xl">
            <div className="border-b border-white/10 bg-white/5 px-6 py-4">
              <div className="text-base font-semibold text-slate-100">{confirmAction.title}</div>
              <div className="mt-2 text-sm text-slate-400">{confirmAction.message}</div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4">
              <button
                type="button"
                onClick={() => !confirmBusy && setConfirmAction(null)}
                disabled={confirmBusy}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold uppercase text-slate-300 transition-all hover:bg-white/10 disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={runConfirmAction}
                disabled={confirmBusy}
                className={
                  confirmAction.danger
                    ? "rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs font-bold uppercase text-rose-300 transition-all hover:bg-rose-500/20 disabled:opacity-50"
                    : "rounded-xl border border-sky-400/30 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase text-sky-100 transition-all hover:bg-sky-500/25 disabled:opacity-50"
                }
              >
                {confirmBusy ? "Procesando..." : confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
{telegramClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl overflow-hidden rounded-3xl border-2 border-white/5 bg-[#161d2b] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-6 py-4">
              <div>
                <div className="text-sm font-bold uppercase tracking-tight text-slate-100">Cliente PAY0 Telegram</div>
                <div className="mt-1 text-xs text-slate-400">{telegramClient.name}</div>
              </div>
              <button
                onClick={() => !telegramBusy && setTelegramClient(null)}
                className="text-slate-400 transition-colors hover:text-white"
              >
                X
              </button>
            </div>

            <div className="grid gap-4 p-6">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-slate-500">Estado</div>
                    <div className="mt-1 text-sm font-semibold text-slate-100">
                      {telegramStatus?.linked ? "Vinculado" : "No vinculado"}
                    </div>
                  </div>

                  <span className={cx(
                    "rounded-xl border px-3 py-1 text-[10px] font-normal uppercase",
                    telegramStatus?.linked
                      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
                      : "border-slate-400/20 bg-white/5 text-slate-400"
                  )}>
                    {telegramStatus?.linked ? "Activo" : "Pendiente"}
                  </span>
                </div>

                {telegramStatus?.linked && (
                  <div className="mt-3 text-xs text-slate-400">
                    Usuario Telegram: {telegramStatus.telegramUsername ? `@${telegramStatus.telegramUsername.replace(/^@/, "")}` : "N/D"}
                  </div>
                )}
              </div>

              {telegramStartUrl && (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Enlace para cliente</div>
                  <div className="mt-2 break-all text-xs text-slate-300">{telegramStartUrl}</div>
                  {telegramExpiresAt && (
                    <div className="mt-2 text-[11px] text-slate-500">
                      Expira: {new Date(telegramExpiresAt).toLocaleString("es-MX")}
                    </div>
                  )}
                </div>
              )}

              {telegramMsg && (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300">
                  {telegramMsg}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 bg-white/5 px-6 py-4">
              <button
                onClick={() => refreshClientTelegramStatus()}
                disabled={telegramBusy}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold uppercase text-slate-300 transition-all hover:bg-white/10 disabled:opacity-50"
              >
                Revisar
              </button>

              <button
                onClick={generateClientTelegramLink}
                disabled={telegramBusy}
                className="rounded-xl border border-sky-400/30 bg-sky-500/20 px-4 py-2 text-xs font-bold uppercase text-sky-100 transition-all hover:bg-sky-500/25 disabled:opacity-50"
              >
                Generar enlace
              </button>

              {telegramStartUrl && (
                <>
                  <button
                    onClick={copyClientTelegramLink}
                    disabled={telegramBusy}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold uppercase text-slate-300 transition-all hover:bg-white/10 disabled:opacity-50"
                  >
                    Copiar
                  </button>

                  <a
                    href={telegramStartUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold uppercase text-slate-300 transition-all hover:bg-white/10"
                  >
                    Abrir
                  </a>
                </>
              )}

              {telegramStatus?.linked && (
                <button
                  onClick={requestUnlinkClientTelegram}
                  disabled={telegramBusy}
                  className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-2 text-xs font-bold uppercase text-rose-300 transition-all hover:bg-rose-500/20 disabled:opacity-50"
                >
                  Desvincular
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b1220]/80 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl bg-[#161d2b] border-2 border-white/5 shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-white/5">
              <div className="text-slate-100 font-bold uppercase tracking-tight">{editing ? "Editar cliente" : "Nuevo cliente"}</div>
              <button onClick={() => !saving && setOpen(false)} className="text-slate-400 hover:text-white transition-colors">X</button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {csfIntake && (
                <div className="md:col-span-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs">
                  <div className="mb-3 font-bold uppercase tracking-wider text-emerald-300">
                    Datos detectados por PAY0
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 text-slate-300">
                    <div><span className="text-slate-500">RFC:</span> {csfIntake.parsed.rfc}</div>
                    <div><span className="text-slate-500">Nombre comercial:</span> {csfIntake.parsed.nombreComercial || "---"}</div>
                    <div className="md:col-span-2"><span className="text-slate-500">Razon social:</span> {csfIntake.parsed.razonSocial}</div>
                    <div className="md:col-span-2"><span className="text-slate-500">Regimen:</span> {csfIntake.parsed.regimenFiscal || csfIntake.parsed.regimenCapital || "---"}</div>
                    <div className="md:col-span-2"><span className="text-slate-500">Domicilio:</span> {[csfIntake.parsed.calle,csfIntake.parsed.numeroExterior,csfIntake.parsed.numeroInterior,csfIntake.parsed.colonia,csfIntake.parsed.municipio,csfIntake.parsed.estado,csfIntake.parsed.codigoPostal].filter(Boolean).join(", ")}</div>
                  </div>
                </div>
              )}

              <div className="md:col-span-2">
                <div className="text-[10px] font-bold text-sky-400 mb-1 uppercase tracking-widest">Nombre / Razon social *</div>
                <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-2xl bg-white/5 border-2 border-white/10 px-4 py-3 text-slate-100 outline-none focus:border-sky-500/50 transition-colors" placeholder="Nombre completo" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-sky-400 mb-1 uppercase tracking-widest">RFC</div>
                <input value={rfc} onChange={(e) => setRfc(e.target.value)} className="w-full rounded-2xl bg-white/5 border-2 border-white/10 px-4 py-3 text-slate-100 outline-none focus:border-sky-500/50 transition-colors" placeholder="XAXX010101000" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-sky-400 mb-1 uppercase tracking-widest">WhatsApp</div>
                <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="w-full rounded-2xl bg-white/5 border-2 border-white/10 px-4 py-3 text-slate-100 outline-none focus:border-sky-500/50 transition-colors" placeholder="Ej: 811..." inputMode="tel" />
              </div>
              <div className="md:col-span-2">
                <div className="text-[10px] font-bold text-sky-400 mb-1 uppercase tracking-widest">Email de contacto</div>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-2xl bg-white/5 border-2 border-white/10 px-4 py-3 text-slate-100 outline-none focus:border-sky-500/50 transition-colors" placeholder="correo@ejemplo.com" inputMode="email" />
              </div>
              {err && <div className="md:col-span-2 text-xs text-rose-200 bg-rose-500/10 border border-rose-400/20 rounded-2xl px-4 py-2">{err}</div>}
            </div>
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3 bg-white/5">
              <button onClick={() => setOpen(false)} disabled={saving} className="rounded-xl px-5 py-2.5 text-xs font-bold uppercase text-slate-400 hover:text-white transition-all">Cancelar</button>
              <button onClick={onSave} disabled={!canSave} className={cx("rounded-xl px-8 py-2.5 text-xs font-bold uppercase transition-all", canSave ? "bg-sky-500 text-[#0b1220] hover:bg-sky-400" : "bg-slate-700 text-slate-500 cursor-not-allowed")}>
                {saving ? "Guardando..." : "Guardar Cliente"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


