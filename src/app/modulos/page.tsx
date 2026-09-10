"use client";

import React from "react";
import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebaseClient";
import { onAuthStateChanged } from "firebase/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole, isSuperAdmin, isAdmin, isOperador, mergeModules } from "@/lib/roles";
import { listUsers } from "@/services/users";

import Modal from "@/components/Modal";
import UserPermissionsPanel from "@/components/UserPermissionsPanel";
import UiSelect, { type UiSelectOption } from "@/components/UiSelect";
import { Settings2 } from "lucide-react";
type UserItem = {
  uid: string;
  email: string | null;
  displayName: string | null;
  nombreusuario?: string | null;
  role: string | null;
  rootId: string | null;
  parentUserId: string | null;
  despachoId?: string | null;
  isActive: boolean;
  isDeleted?: boolean;
  userNumber?: number | null;
  numeroUsuario?: number | null;
  sequenceNumber?: number | null;
};

function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function actionIconClass() {
  return "inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 hover:text-sky-400 disabled:cursor-not-allowed disabled:opacity-40";
}

function roleBadge(role: string) {
  const r = normalizeRole(role);
  if (r === "admin") return "bg-sky-500/15 border-sky-400/30 text-sky-200";
  if (r === "operador") return "bg-amber-500/15 border-amber-400/30 text-amber-200";
  if (r === "superadmin") return "bg-emerald-500/15 border-emerald-400/30 text-emerald-200";
  return "bg-white/10 border-white/10 text-slate-200";
}

function formatUserFolio(user: UserItem) {
  const number = Number(
    user.userNumber ?? user.numeroUsuario ?? user.sequenceNumber ?? 0
  );
  if (!Number.isFinite(number) || number <= 0) return "";
  return `U${String(number).padStart(2, "0")}`;
}

export default function ModulosPage() {
  const { profile } = useUserProfile();
  const meRole = normalizeRole((profile as any)?.role);
  const meDespachoId = (profile as any)?.despachoId as string | null;

  const modules = useMemo(
    () => mergeModules((profile as any)?.role, (profile as any)?.modules),
    [profile]
  );

  const canViewModulos = !!modules?.modulos?.view;

  const isSuper = isSuperAdmin(meRole);
  const isAdminRole = isAdmin(meRole);

  const [meUid, setMeUid] = useState<string>("");
  const [meEmail, setMeEmail] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [usersCursor, setUsersCursor] = useState<string | null>(null);
  const [usersHasMore, setUsersHasMore] = useState(false);
  const [openPermsUid, setOpenPermsUid] = useState<string>("");

  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "operador">("all");

  const InputClass =
    "w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:ring-2 focus:ring-white/10";

  const roleFilterOptions = useMemo<UiSelectOption[]>(
    () => [
      { value: "all", label: "Todos" },
      { value: "admin", label: "Admin" },
      { value: "operador", label: "Operador" },
    ],
    []
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setMeUid(u?.uid || "");
      setMeEmail(u?.email || "");
    });
    return () => unsub();
  }, []);

  async function refresh() {
    setMsg("");
    setLoading(true);
    try {
      const payload: any = {};
      if (isSuper) {
        payload.rootId = meUid;
        payload.email = meEmail;
      }

      const res: any = await listUsers({ ...payload, limit: 100 });
      setUsers((res?.users || []) as UserItem[]);
      setUsersCursor(res?.nextCursor || null);
      setUsersHasMore(res?.hasMore === true);
    } catch (e: any) {
      setMsg(`Error listando: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreUsers() {
    if (!usersHasMore || !usersCursor) return;
    setLoading(true);
    try {
      const payload: any = { limit: 100, cursor: usersCursor };
      if (isSuper) { payload.rootId = meUid; payload.email = meEmail; }
      const res: any = await listUsers(payload);
      setUsers((current) => [...current, ...((res?.users || []) as UserItem[])]);
      setUsersCursor(res?.nextCursor || null);
      setUsersHasMore(res?.hasMore === true);
    } catch (e: any) { setMsg(`Error listando: ${e?.code || ""} ${e?.message || e}`); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!canViewModulos || !meUid || !meRole) {
      setUsers([]);
      return;
    }
    refresh();
  }, [meUid, meRole, canViewModulos]);

  const visibleUsers = useMemo(() => {
    let base = [...users];

    if (isAdminRole) {
      base = base.filter((u) => {
        const role = normalizeRole(u.role);
        return isOperador(role) && String(u.parentUserId || "") === meUid;
      });
    } else if (isSuper) {
      base = base.filter((u) => !isSuperAdmin(u.role));
    }

    const qq = q.trim().toLowerCase();

    return base.filter((u) => {
      const deleted = !!u.isDeleted;
      if (deleted) return false;

      const role = normalizeRole(u.role);
      const isOp = isOperador(role);
      const isAdm = isAdmin(role);

      if (roleFilter === "admin" && !isAdm) return false;
      if (roleFilter === "operador" && !isOp) return false;

      if (qq) {
        const userFolio = formatUserFolio(u).toLowerCase();
        const hay =
          String(u.displayName || u.nombreusuario || "").toLowerCase().includes(qq) ||
          String(u.email || "").toLowerCase().includes(qq) ||
          userFolio.includes(qq);

        if (!hay) return false;
      }

      return true;
    });
  }, [users, q, roleFilter, isAdminRole, isSuper, meUid]);

  if (!canViewModulos) {
    return (
      <main className="p-6 text-slate-400">
        No tienes acceso a Modulos.
      </main>
    );
  }

  return (
    <main className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-slate-100 text-2xl font-semibold">Modulos</div>
          <div className="text-slate-400 text-sm mt-1">
          </div>
        </div>
        {usersHasMore ? (
          <div className="mt-3 text-right">
            <button onClick={loadMoreUsers} disabled={loading} className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-slate-100 hover:bg-white/15 disabled:opacity-50">
              {loading ? "Cargando..." : "Cargar más usuarios"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-6 p-4 rounded-2xl bg-white/5 border border-white/10">
        <div className="grid gap-3 md:grid-cols-12 items-end">
          <div className="md:col-span-8">
            <label className="block text-slate-300 text-sm mb-1">Buscar</label>
            <input
              className={InputClass}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="nombre, email o folio..."
            />
            <div className="text-slate-500 text-xs mt-1">Resultados: {visibleUsers.length}</div>
          </div>

          <div className="md:col-span-4">
            <label className="block text-slate-300 text-sm mb-1">Rol</label>
            <UiSelect
              value={roleFilter}
              options={roleFilterOptions}
              onChange={(v) => setRoleFilter(v as any)}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 p-4 rounded-2xl bg-white/5 border border-white/10">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400">
              <tr className="border-b border-white/10">
                <th className="text-left py-3 pr-3">Nombre</th>
                <th className="text-left py-3 pr-3">Email</th>
                <th className="text-left py-3 pr-3">Rol</th>
                <th className="text-right py-3">ACC.</th>
              </tr>
            </thead>

            <tbody className="text-slate-200">
              {visibleUsers.map((u) => (
                <tr key={u.uid} className="border-b border-white/5">
                  <td className="py-3 pr-3 font-semibold">
                    <div>{u.displayName || u.nombreusuario || u.email || "Usuario sin nombre"}</div>
                    <div className="mt-1 text-xs font-normal text-sky-300">
                      {formatUserFolio(u) || "Sin folio"}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-slate-300">{u.email || "-"}</td>
                  <td className="py-3 pr-3">
                    <span className={cx("inline-flex items-center px-2 py-1 rounded-lg border text-xs", roleBadge(String(u.role || "")))}>
                      {normalizeRole(String(u.role || "")) || "-"}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setOpenPermsUid(u.uid)}
                      className={actionIconClass()}
                      title="Configurar modulos"
                      aria-label="Configurar modulos"
                    >
                      <Settings2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}

              {visibleUsers.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-slate-400">
                    Sin resultados con esos filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {msg && <div className="mt-4 text-slate-200 text-sm">{msg}</div>}

      <Modal open={!!openPermsUid} title="Modulos y permisos" onClose={() => setOpenPermsUid("")} widthClassName="max-w-4xl">
        {openPermsUid ? (
          <UserPermissionsPanel
            meUid={meUid}
            meRole={meRole}
            meDespachoId={meDespachoId}
            targetUid={openPermsUid}
            onClose={() => setOpenPermsUid("")}
          />
        ) : null}
      </Modal>
    </main>
  );
}





