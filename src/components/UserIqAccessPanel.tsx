"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IQ_MODULE_LABELS,
  IQ_MODULES,
  IqCredentialProfile,
  IqModule,
  IqUserAccess,
  listIqCredentialProfiles,
  listUserIqAccess,
  removeUserIqAccess,
  updateUserIqAccess,
} from "@/services/iq";

type Props = {
  targetUid: string;
  targetName?: string | null;
  targetEmail?: string | null;
  onClose?: () => void;
};

const emptyModules = IQ_MODULES.reduce((acc, moduleKey) => {
  acc[moduleKey] = false;
  return acc;
}, {} as Record<IqModule, boolean>);

function normalizeModules(value: Record<string, boolean> | undefined | null): Record<IqModule, boolean> {
  return IQ_MODULES.reduce((acc, moduleKey) => {
    acc[moduleKey] = value?.[moduleKey] === true;
    return acc;
  }, {} as Record<IqModule, boolean>);
}

export default function UserIqAccessPanel({ targetUid, targetName, targetEmail, onClose }: Props) {
  const [profiles, setProfiles] = useState<IqCredentialProfile[]>([]);
  const [accessRows, setAccessRows] = useState<IqUserAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [iqEnabled, setIqEnabled] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [modules, setModules] = useState<Record<IqModule, boolean>>({ ...emptyModules });

  const activeProfiles = useMemo(
    () => profiles.filter((profile) => profile.active),
    [profiles],
  );

  const currentAccess = useMemo(
    () => accessRows.find((row) => row.pay0UserId === targetUid) || null,
    [accessRows, targetUid],
  );

  async function loadData() {
    setLoading(true);
    setMsg("");

    try {
      const [profileList, accessList] = await Promise.all([
        listIqCredentialProfiles(),
        listUserIqAccess(),
      ]);

      setProfiles(profileList);
      setAccessRows(accessList);

      const current = accessList.find((row) => row.pay0UserId === targetUid) || null;

      if (current?.active && current.iqEnabled) {
        setIqEnabled(true);
        setSelectedProfileId(current.iqCredentialProfileId || "");
        setModules(normalizeModules(current.allowedModules));
      } else {
        setIqEnabled(false);
        setSelectedProfileId("");
        setModules({ ...emptyModules });
      }
    } catch (error) {
      const err = error as Error;
      setMsg(err.message || "No se pudo cargar acceso IQ.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!targetUid) return;
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetUid]);

  async function saveAccess() {
    setSaving(true);
    setMsg("");

    try {
      if (!iqEnabled) {
        await removeUserIqAccess(targetUid);
        setMsg("Acceso IQ desactivado.");
        await loadData();
        return;
      }

      if (!selectedProfileId) {
        setMsg("Selecciona una cuenta IQ.");
        return;
      }

      await updateUserIqAccess({
        pay0UserId: targetUid,
        iqEnabled: true,
        iqCredentialProfileId: selectedProfileId,
        allowedModules: modules,
      });

      setMsg("Acceso IQ guardado.");
      await loadData();
    } catch (error) {
      const err = error as Error;
      setMsg(err.message || "No se pudo guardar acceso IQ.");
    } finally {
      setSaving(false);
    }
  }

  async function removeAccess() {
    setSaving(true);
    setMsg("");

    try {
      await removeUserIqAccess(targetUid);
      setIqEnabled(false);
      setSelectedProfileId("");
      setModules({ ...emptyModules });
      setMsg("Acceso IQ removido.");
      await loadData();
    } catch (error) {
      const err = error as Error;
      setMsg(err.message || "No se pudo remover acceso IQ.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-slate-300">Cargando acceso IQ...</div>;
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="text-xs uppercase tracking-[0.18em] text-sky-300">Usuario PAY0</div>
        <div className="mt-1 text-lg font-semibold text-white">
          {targetName || targetEmail || targetUid}
        </div>
        <div className="text-sm text-slate-400">{targetEmail || targetUid}</div>
      </div>

      {msg ? (
        <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
          {msg}
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <label className="flex items-center gap-3 text-slate-100">
          <input
            type="checkbox"
            checked={iqEnabled}
            onChange={(event) => setIqEnabled(event.target.checked)}
          />
          <span>Habilitar acceso IQ para este usuario</span>
        </label>

        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-sm text-slate-300">
            Cuenta IQ asignada
            <select
              value={selectedProfileId}
              disabled={!iqEnabled || activeProfiles.length === 0}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-slate-100 outline-none"
            >
              <option value="">Selecciona cuenta IQ</option>
              {activeProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.alias} - {profile.usernameMasked}
                </option>
              ))}
            </select>
          </label>

          {activeProfiles.length === 0 ? (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              No hay cuentas IQ activas. Primero registra una cuenta en Integraciones / IQ.
            </div>
          ) : null}

          <div className="grid gap-2">
            <div className="text-sm text-slate-300">Modulos IQ permitidos</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {IQ_MODULES.map((moduleKey) => (
                <label
                  key={moduleKey}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100"
                >
                  <input
                    type="checkbox"
                    disabled={!iqEnabled}
                    checked={modules[moduleKey]}
                    onChange={(event) =>
                      setModules((current) => ({
                        ...current,
                        [moduleKey]: event.target.checked,
                      }))
                    }
                  />
                  <span>{IQ_MODULE_LABELS[moduleKey]}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
        <div className="font-semibold text-slate-100">Estado actual</div>
        <div className="mt-2 grid gap-1">
          <div>Acceso: {currentAccess?.active && currentAccess?.iqEnabled ? "Activo" : "Inactivo"}</div>
          <div>Cuenta: {currentAccess?.iqCredentialAlias || currentAccess?.iqCredentialProfileId || "-"}</div>
          <div>
            Modulos:{" "}
            {IQ_MODULES.filter((moduleKey) => currentAccess?.allowedModules?.[moduleKey])
              .map((moduleKey) => IQ_MODULE_LABELS[moduleKey])
              .join(", ") || "-"}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-slate-200 hover:bg-white/10"
        >
          Cerrar
        </button>
        <button
          type="button"
          disabled={saving || !currentAccess}
          onClick={removeAccess}
          className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-red-100 hover:bg-red-500/15 disabled:opacity-50"
        >
          Remover
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={saveAccess}
          className="rounded-xl border border-sky-400/30 bg-sky-500/20 px-4 py-2 font-semibold text-sky-100 hover:bg-sky-500/25 disabled:opacity-50"
        >
          Guardar acceso IQ
        </button>
      </div>
    </div>
  );
}