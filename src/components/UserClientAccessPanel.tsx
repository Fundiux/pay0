"use client";

import { useEffect, useMemo, useState } from "react";
import { useGlobalLoading } from "@/components/GlobalLoading";
import {
  getUserClientAccessConfig,
  saveUserClientAccess,
  type UserClientAccessItemPayload,
} from "@/services/users";

type PermissionKey =
  | "viewBasic"
  | "operateSolicitudes"
  | "operatePagos"
  | "operateBeneficiarios"
  | "operateDispersiones"
  | "viewBalanceInDispersion"
  | "requestDispersionIncidents"
  | "commentDispersionNotes";

type PermissionState = Record<PermissionKey, boolean> & {
  view: boolean;
  operate: boolean;
};

type ClientAccessItem = {
  clientId: string;
  clientName: string;
  clientNumber?: number;
  active?: boolean;
  permissions?: Partial<PermissionState> | null;
  mode?: "PERMANENT" | "TEMPORARY";
  expiresAt?: any;
  grantReason?: string | null;
};

type ClientAccessState = {
  active: boolean;
  permissions: PermissionState;
};

type Props = {
  targetUid: string;
  onClose: () => void;
};

const PERMISSION_BUTTONS: Array<{
  key: PermissionKey;
  label: string;
  title: string;
}> = [
  { key: "viewBasic", label: "Ver", title: "Ver cliente basico" },
  { key: "operateSolicitudes", label: "Solic", title: "Operar solicitudes" },
  { key: "operatePagos", label: "Pagos", title: "Operar pagos" },
  { key: "operateBeneficiarios", label: "Benef", title: "Operar beneficiarios" },
  { key: "operateDispersiones", label: "Disp", title: "Operar dispersiones" },
  { key: "viewBalanceInDispersion", label: "Saldo", title: "Ver saldo en dispersion" },
];

function formatClientNumber(n: unknown) {
  const value = Number(n || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  return `C${String(value).padStart(2, "0")}`;
}

function buildDefaultPermissions(active: boolean): PermissionState {
  return {
    view: active,
    operate: active,
    viewBasic: active,
    operateSolicitudes: active,
    operatePagos: active,
    operateBeneficiarios: active,
    operateDispersiones: active,
    viewBalanceInDispersion: active,
    requestDispersionIncidents: active,
    commentDispersionNotes: active,
  };
}

function buildViewOnlyPermissions(): PermissionState {
  return {
    view: true,
    operate: false,
    viewBasic: true,
    operateSolicitudes: false,
    operatePagos: false,
    operateBeneficiarios: false,
    operateDispersiones: false,
    viewBalanceInDispersion: false,
    requestDispersionIncidents: false,
    commentDispersionNotes: false,
  };
}

function normalizePermissions(raw: Partial<PermissionState> | null | undefined, active: boolean): PermissionState {
  if (!active) return buildDefaultPermissions(false);

  const legacyView = raw?.view !== false;
  const legacyOperate = raw?.operate !== false;

  return {
    view: legacyView,
    operate: legacyOperate,
    viewBasic: raw?.viewBasic ?? legacyView,
    operateSolicitudes: raw?.operateSolicitudes ?? legacyOperate,
    operatePagos: raw?.operatePagos ?? legacyOperate,
    operateBeneficiarios: raw?.operateBeneficiarios ?? legacyOperate,
    operateDispersiones: raw?.operateDispersiones ?? legacyOperate,
    viewBalanceInDispersion: raw?.viewBalanceInDispersion ?? legacyView,
    requestDispersionIncidents: raw?.requestDispersionIncidents ?? legacyOperate,
    commentDispersionNotes: raw?.commentDispersionNotes ?? legacyOperate,
  };
}

function normalizeState(item: ClientAccessItem): ClientAccessState {
  const active = item.active === true;
  return {
    active,
    permissions: normalizePermissions(item.permissions, active),
  };
}

function hasAnyOperatePermission(permissions: PermissionState) {
  return (
    permissions.operateSolicitudes ||
    permissions.operatePagos ||
    permissions.operateBeneficiarios ||
    permissions.operateDispersiones ||
    permissions.requestDispersionIncidents ||
    permissions.commentDispersionNotes
  );
}

function normalizePermissionConsistency(permissions: PermissionState): PermissionState {
  const next = { ...permissions };
  next.view = next.viewBasic === true;
  next.operate = hasAnyOperatePermission(next);
  return next;
}

export default function UserClientAccessPanel({ targetUid, onClose }: Props) {
  const [clients, setClients] = useState<ClientAccessItem[]>([]);
  const [accessMap, setAccessMap] = useState<Record<string, ClientAccessState>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const globalLoading = useGlobalLoading();
const [msg, setMsg] = useState("");

  async function load() {
    if (!targetUid) return;

    setMsg("");
    setLoading(true);

    try {
      const res: any = await getUserClientAccessConfig(targetUid);
      const list = (res?.clients || []) as ClientAccessItem[];

      const next: Record<string, ClientAccessState> = {};
      list.forEach((item) => {
        next[item.clientId] = normalizeState(item);
      });

      setClients(list);
      setAccessMap(next);
    } catch (e: any) {
      setMsg(`Error cargando clientes: ${e?.code || ""} ${e?.message || e}`);
      setClients([]);
      setAccessMap({});
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUid]);

  const activeItems = useMemo(() => {
    return clients
      .map((client): UserClientAccessItemPayload | null => {
        const state = accessMap[client.clientId];
        if (!state?.active) return null;

        return {
          clientId: client.clientId,
          active: true,
          permissions: normalizePermissionConsistency(state.permissions),
          mode: "PERMANENT",
          expiresAt: null,
          grantReason: null,
        };
      })
      .filter(Boolean) as UserClientAccessItemPayload[];
  }, [clients, accessMap]);

  const selectedIds = useMemo(() => {
    return activeItems.map((item) => item.clientId);
  }, [activeItems]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();

    if (!term) return clients;

    return clients.filter((item) => {
      return (
        String(item.clientName || "").toLowerCase().includes(term) ||
        String(item.clientId || "").toLowerCase().includes(term) ||
        formatClientNumber(item.clientNumber).toLowerCase().includes(term)
      );
    });
  }, [clients, q]);

  function setClientState(clientId: string, updater: (current: ClientAccessState) => ClientAccessState) {
    setAccessMap((prev) => {
      const current =
        prev[clientId] || {
          active: false,
          permissions: buildDefaultPermissions(false),
        };

      return {
        ...prev,
        [clientId]: updater(current),
      };
    });
  }

  function toggleClient(clientId: string) {
    setClientState(clientId, (current) => {
      const active = !current.active;
      return {
        active,
        permissions: active ? buildDefaultPermissions(true) : buildDefaultPermissions(false),
      };
    });
  }

  function setViewOnly(clientId: string) {
    setClientState(clientId, () => ({
      active: true,
      permissions: buildViewOnlyPermissions(),
    }));
  }

  function setFullAccess(clientId: string) {
    setClientState(clientId, () => ({
      active: true,
      permissions: buildDefaultPermissions(true),
    }));
  }

  function togglePermission(clientId: string, key: PermissionKey) {
    setClientState(clientId, (current) => {
      const permissions = {
        ...current.permissions,
        [key]: !current.permissions[key],
      };

      if (key !== "viewBasic" && permissions[key]) {
        permissions.viewBasic = true;
      }

      if (key === "viewBasic" && !permissions.viewBasic) {
        return {
          active: false,
          permissions: buildDefaultPermissions(false),
        };
      }

      return {
        active: true,
        permissions: normalizePermissionConsistency(permissions),
      };
    });
  }

  async function save() {
    if (saving || loading) return;

    setMsg("");
    setSaving(true);

    try {
      await globalLoading.run(
        undefined,
        async () => {
          await saveUserClientAccess(targetUid, activeItems);
          setMsg(`OK: ${selectedIds.length} clientes autorizados.`);
          await load();
        }
      );
    } catch (e: any) {
      setMsg(`Error guardando clientes: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="text-sm text-slate-300">
          Autoriza clientes especificos por permiso. Delegar operacion no cambia propietario, costos ni cadena economica.
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            className="w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-white/10"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente..."
          />

          <button
            type="button"
            onClick={load}
            disabled={loading || saving}
            className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/15 disabled:opacity-60"
          >
            {loading ? "Cargando..." : "Recargar"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">Clientes autorizados</div>
            <div className="text-xs text-slate-500">
              Activos: {selectedIds.length} / {clients.length}
            </div>
          </div>
        </div>

        <div className="max-h-[460px] overflow-auto p-3">
          <div className="grid gap-2">
            {filtered.map((client) => {
              const state =
                accessMap[client.clientId] || {
                  active: false,
                  permissions: buildDefaultPermissions(false),
                };

              return (
                <div
                  key={client.clientId}
                  className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 transition hover:bg-white/5 md:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={!!state.active}
                      onChange={() => toggleClient(client.clientId)}
                      disabled={saving || loading}
                      aria-label={`Activar ${client.clientName || client.clientId}`}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-100">
                        {client.clientName || client.clientId}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatClientNumber(client.clientNumber) || client.clientId}
                      </div>
                    </div>

                    <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300">
                      {state.active ? "Activo" : "Inactivo"}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 md:justify-end">
                    <button
                      type="button"
                      onClick={() => setViewOnly(client.clientId)}
                      disabled={saving || loading}
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
                      title="Solo ver"
                    >
                      Solo ver
                    </button>

                    <button
                      type="button"
                      onClick={() => setFullAccess(client.clientId)}
                      disabled={saving || loading}
                      className="rounded-lg border border-sky-400/20 bg-sky-500/10 px-2 py-1 text-[11px] font-semibold text-sky-100 transition hover:bg-sky-500/20 disabled:opacity-50"
                      title="Permisos operativos completos"
                    >
                      Full
                    </button>

                    {PERMISSION_BUTTONS.map((perm) => {
                      const enabled = state.active && state.permissions[perm.key];

                      return (
                        <button
                          key={perm.key}
                          type="button"
                          onClick={() => togglePermission(client.clientId, perm.key)}
                          disabled={saving || loading || !state.active}
                          className={[
                            "rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-40",
                            enabled
                              ? "border-cyan-300/30 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/20"
                              : "border-white/10 bg-white/5 text-slate-500 hover:bg-white/10",
                          ].join(" ")}
                          title={perm.title}
                          aria-label={`${perm.title}: ${client.clientName || client.clientId}`}
                        >
                          {perm.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {!loading && filtered.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                Sin clientes disponibles.
              </div>
            )}

            {loading && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                Cargando clientes...
              </div>
            )}
          </div>
        </div>
      </div>
<div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || loading}
          className="rounded-xl border border-sky-400/30 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/25 disabled:opacity-60"
        >
          {saving ? "Guardando..." : "Guardar clientes"}
        </button>

        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/15 disabled:opacity-60"
        >
          Cerrar
        </button>

        {msg && <div className="text-sm text-slate-200">{msg}</div>}
      </div>
    </div>
  );
}
