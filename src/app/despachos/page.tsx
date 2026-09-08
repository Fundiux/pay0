// src/app/despachos/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole, isSuperAdmin } from "@/lib/roles";
import { useRouter } from "next/navigation";
import { Building2, CircleDollarSign, Pencil, Power, PowerOff } from "lucide-react";
import { toggleDespachoActive } from "@/services/despachos";
import { saveDespachoMutation as saveDespacho } from "@/services/despachoMutations";

type DespachoRow = {
  id: string;
  nombre: string;

  active?: boolean;
  rootId?: string;
  createdBy?: string;

  createdAt?: any;
  updatedAt?: any;
};

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

function actionIconClass(kind: "empresas" | "costos" | "edit" | "on" | "off") {
  const base = "inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";
  const map: Record<string, string> = {
    empresas: "hover:text-sky-400",
    costos: "hover:text-emerald-400",
    edit: "hover:text-yellow-400",
    on: "hover:text-emerald-400",
    off: "hover:text-rose-500",
  };

  return `${base} ${map[kind] || ""}`;
}


export default function DespachosPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { profile, loading } = useUserProfile();

  const uid = (user as any)?.uid as string | undefined;
  const role = normalizeRole((profile as any)?.role);
  const profileRootId = (profile as any)?.rootId as string | undefined;

  const effectiveRootId = useMemo(() => profileRootId || uid || "", [profileRootId, uid]);
  const isSuperadmin = isSuperAdmin(role);

  const [items, setItems] = useState<DespachoRow[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DespachoRow | null>(null);

  const [nombre, setNombre] = useState("");

  const [saving, setSaving] = useState(false);
  const [toggleBusyId, setToggleBusyId] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!effectiveRootId) return;

    const qy = query(
      collection(db, "despachos"),
      where("rootId", "==", effectiveRootId),
      orderBy("nombre", "asc")
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const arr: DespachoRow[] = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
        setItems(arr);
      },
      (e) => console.warn("[despachos] snapshot:", (e as any)?.code || (e as any)?.message || e)
    );

    return () => unsub();
  }, [effectiveRootId]);

  const canSave = useMemo(() => {
    if (loading) return false;
    if (!uid || !effectiveRootId) return false;
    if (!isSuperadmin) return false;
    if (saving) return false;

    const n = nombre.trim();
    if (n.length < 2) return false;

    return true;
  }, [loading, uid, effectiveRootId, isSuperadmin, saving, nombre]);

  function openCreate() {
    setEditing(null);
    setNombre("");
    setErr(null);
    setOpen(true);
  }

  function openEdit(it: DespachoRow) {
    setEditing(it);
    setNombre(it.nombre || "");
    setErr(null);
    setOpen(true);
  }

  async function onSave() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);

    try {
      await saveDespacho({
        editingId: editing?.id || null,
        rootId: effectiveRootId,
        uid: uid!,
        nombre,
      });

      setOpen(false);
      setEditing(null);
      setNombre("");
      } catch (e: any) {
      setErr(e?.message || "Missing or insufficient permissions.");
    } finally {
      setSaving(false);
    }
  }

  async function onToggleActive(id: string, nextActive: boolean) {
    if (toggleBusyId === id) return;

    setToggleBusyId(id);
    try {
      await toggleDespachoActive(id, nextActive);
    } catch (e: any) {
      setErr(e?.message || "No se pudo actualizar despacho.");
    } finally {
      setToggleBusyId("");
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-slate-100 text-xl font-semibold">Despachos</div>
        </div>

        {isSuperadmin && (
          <button
            onClick={openCreate}
            className="rounded-2xl px-4 py-2.5 font-semibold border bg-sky-500/20 border-sky-400/30 text-sky-100 hover:bg-sky-500/25"
          >
            Nuevo despacho
          </button>
        )}
      </div>

      <div className="pay0-table-card mt-6">
        <div className="grid grid-cols-12 gap-2 border-b border-white/10 bg-white/5 px-3 py-2 text-[12px] font-normal uppercase tracking-widest text-slate-500">
          <div className="col-span-6">Nombre</div>
          <div className="col-span-2">Estatus</div>
          <div className="col-span-4 text-right">ACC.</div>
        </div>

        {items.length === 0 ? (
          <div className="pay0-empty-cell">Sin despachos</div>
        ) : (
          items.map((it, index) => {
            const isActive = it.active !== false;
            return (
              <div key={it.id} className={`grid min-h-[38px] grid-cols-12 items-center gap-2 px-3 py-1.5 text-[13px] font-normal transition-colors ${index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}`}>
                <div className="col-span-6 flex items-center text-[13px] font-normal text-slate-100">
                  {it.nombre} {!isActive && <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-tighter text-slate-500">Inactivo</span>}
                </div>
                <div className="col-span-2 flex items-center text-[13px] font-normal text-slate-300">{isActive ? "Activo" : "Inactivo"}</div>
                <div className="col-span-4 flex items-center justify-end gap-2 text-right flex-nowrap whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => router.push(`/despachos/${it.id}`)}
                    className={actionIconClass("empresas")}
                    title="Empresas"
                    aria-label="Empresas"
                  >
                    <Building2 size={16} />
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push(`/despachos/${it.id}/costos`)}
                    className={actionIconClass("costos")}
                    title="Costos"
                    aria-label="Costos"
                  >
                    <CircleDollarSign size={16} />
                  </button>

                  {isSuperadmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => openEdit(it)}
                        className={actionIconClass("edit")}
                        title="Editar"
                        aria-label="Editar"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onToggleActive(it.id, !isActive)}
                        disabled={toggleBusyId === it.id}
                        className={actionIconClass(isActive ? "off" : "on")}
                        title={isActive ? "Desactivar" : "Activar"}
                        aria-label={isActive ? "Desactivar" : "Activar"}
                      >
                        {isActive ? <PowerOff size={16} /> : <Power size={16} />}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => !saving && setOpen(false)} />
          <div className="absolute inset-0 grid place-items-center p-4">
            <div className="w-full max-w-xl rounded-3xl bg-[#0b1220] border border-white/10 shadow-2xl">
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                <div className="text-slate-100 font-semibold">
                  {editing ? "Editar despacho" : "Nuevo despacho"}
                </div>
                <button
                  onClick={() => !saving && setOpen(false)}
                  className="h-9 w-9 rounded-2xl border border-white/10 hover:bg-white/5 text-slate-200"
                >
                  X  
                </button>
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <div className="text-xs text-slate-400 mb-1">Nombre *</div>
                  <input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-slate-100 outline-none"
                    placeholder="IQ"
                  />
                </div>

                

                {err && (
                  <div className="md:col-span-2 text-sm text-rose-200 bg-rose-500/10 border border-rose-400/20 rounded-2xl px-4 py-2">
                    {err}
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2">
                <button
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="rounded-2xl px-4 py-2.5 font-semibold border border-white/10 text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={onSave}
                  disabled={!canSave}
                  className={cx(
                    "rounded-2xl px-4 py-2.5 font-semibold border",
                    canSave
                      ? "bg-sky-500/20 border-sky-400/30 text-sky-100 hover:bg-sky-500/25"
                      : "bg-white/5 border-white/10 text-slate-500 cursor-not-allowed"
                  )}
                >
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}








