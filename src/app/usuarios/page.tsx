"use client";

import Link from "next/link";
import NoAccess from "@/components/NoAccess";
import { useModuleAccess } from "@/lib/useModuleAccess";

import React from "react";
import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebaseClient";
import { onAuthStateChanged } from "firebase/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole, isSuperAdmin, isAdmin, isOperador } from "@/lib/roles";
import { listUsers, createAdminUser, createOperadorUser, updateUserActive, softDeleteUserById, restoreUserById, repairUserNumbersByRoot } from "@/services/users";
import { CircleDollarSign, RotateCcw, Settings2, Power, PowerOff, Trash2, UsersRound } from "lucide-react";
import Modal from "@/components/Modal";
import UserPermissionsPanel from "@/components/UserPermissionsPanel";
import UserClientAccessPanel from "@/components/UserClientAccessPanel";
import UiSelect from "@/components/UiSelect";

type UserItem = {
  uid: string;
  email: string | null;
  displayName: string | null;
  nombreusuario?: string | null;
  phone: string | null;
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

type DespachoLite = { id: string; nombre?: string };

function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

function actionIconClass(kind: "iq" | "costos" | "permisos" | "clientes" | "on" | "off" | "delete" | "restore") {
  const base = "inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";
  const map: Record<string, string> = {
    iq: "rounded-md border border-violet-400/25 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300 hover:border-violet-400/50 hover:text-violet-200",
    costos: "hover:text-emerald-400",
    permisos: "hover:text-sky-400",
    clientes: "hover:text-cyan-300",
    on: "hover:text-emerald-400",
    off: "hover:text-rose-500",
    delete: "hover:text-rose-500",
    restore: "hover:text-emerald-400",
  };

  return `${base} ${map[kind] || ""}`;
}

function roleBadge(role: string) {
  const r = normalizeRole(role);
  if (r === "admin") return "bg-sky-500/15 border-sky-400/30 text-sky-200";
  if (r === "operador") return "bg-amber-500/15 border-amber-400/30 text-amber-200";
  if (r === "superadmin") return "bg-emerald-500/15 border-emerald-400/30 text-emerald-200";
  return "bg-white/10 border-white/10 text-slate-200";
}

function statusBadge(isActive: boolean) {
  return isActive
    ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-200"
    : "bg-rose-500/15 border-rose-400/30 text-rose-200";
}


function formatUserNumber(u: UserItem) {
  const n = Number(u.userNumber ?? u.numeroUsuario ?? u.sequenceNumber ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "U00";
  return `U${String(n).padStart(2, "0")}`;
}
export default function UsuariosPage() {
  const { profile } = useUserProfile();
  const meRole = normalizeRole((profile as any)?.role);
  const meDespachoId = (profile as any)?.despachoId as string | null;

  const { modules, canAccess: canViewUsuarios } = useModuleAccess(profile, "usuarios", "view");
  const canCreateUsuarios = !!modules?.usuarios?.create;
  const canActivateUsuarios = !!modules?.usuarios?.activate;
  const canPermissionsUsuarios = !!modules?.usuarios?.permissions;
  const canCostsUsuarios = !!modules?.usuarios?.costs;
  const canClientDelegationsUsuarios = !!modules?.usuarios?.clientDelegations;

  const isSuper = isSuperAdmin(meRole);
  const isAdminRole = isAdmin(meRole);

  const [meUid, setMeUid] = useState<string>("");
  const [meEmail, setMeEmail] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [repairingNumbers, setRepairingNumbers] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const [users, setUsers] = useState<UserItem[]>([]);
  const [usersCursor, setUsersCursor] = useState<string | null>(null);
  const [usersHasMore, setUsersHasMore] = useState(false);
  const [view, setView] = useState<"table" | "cards">("table");

  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "operador">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("active");

  const [openCreate, setOpenCreate] = useState(false);
  const [openPermsUid, setOpenPermsUid] = useState<string>("");
  const [openClientAccessUid, setOpenClientAccessUid] = useState<string>("");

  const [expandedAdminUid, setExpandedAdminUid] = useState<string>("");

  const [operatorParentMode, setOperatorParentMode] = useState<"admin" | "superadmin">("admin");
  const [parentAdminUid, setParentAdminUid] = useState<string>("");
  const [despachoIdForDirectOperator, setDespachoIdForDirectOperator] = useState<string>("");

  const [roleToCreate, setRoleToCreate] = useState<"admin" | "operador">("operador");
  const [despachos, setDespachos] = useState<DespachoLite[]>([]);
  const [despachoIdToCreate, setDespachoIdToCreate] = useState<string>("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const SelectClass =
    "w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-slate-100 " +
    "focus:outline-none focus:ring-2 focus:ring-white/10";

  const InputClass =
    "w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-slate-100 " +
    "focus:outline-none focus:ring-2 focus:ring-white/10";

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
      console.error("listUsers error =>", e, e?.code, e?.message, e?.details);
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
    } catch (e: any) { setMsg(`Error listando: ${e?.message || e}`); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!canViewUsuarios || !meUid || !meRole) {
      setUsers([]);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meUid, meRole, canViewUsuarios]);

  const adminsOnly = useMemo(() => {
    return users.filter((u) => isAdmin(u.role));
  }, [users]);

  const visibleUsers = useMemo(() => {
    let base = [...users];

    if (isAdminRole) {
      base = base.filter((u) => {
        const role = normalizeRole(u.role);
        return isOperador(role) && String(u.parentUserId || "") === meUid;
      });
    } else if (isSuper) {
      base = base;
    }

    const qq = q.trim().toLowerCase();

    return base.filter((u) => {
      const role = normalizeRole(u.role);
      const isOp = isOperador(role);
      const isAdm = isAdmin(role);

      if (roleFilter === "admin" && !isAdm) return false;
      if (roleFilter === "operador" && !isOp) return false;

      const deleted = !!u.isDeleted;

      if (statusFilter === "active" && (!u.isActive || deleted)) return false;
      if (statusFilter === "inactive" && (u.isActive || deleted)) return false;
      
      if (qq) {
        const hay =
          String(u.displayName || u.nombreusuario || "").toLowerCase().includes(qq) ||
          String(u.email || "").toLowerCase().includes(qq);

        if (!hay) return false;
      }

      return true;
    });
  }, [users, q, roleFilter, statusFilter, isAdminRole, isSuper, meUid]);

  const opsByAdmin = useMemo(() => {
    const map = new Map<string, UserItem[]>();

    visibleUsers.forEach((u) => {
      const r = normalizeRole(u.role);
      if (r === "operador") {
        const pid = String(u.parentUserId || "");
        if (!pid) return;
        if (!map.has(pid)) map.set(pid, []);
        map.get(pid)!.push(u);
      }
    });

    map.forEach((arr) =>
      arr.sort((a, b) =>
        String(a.displayName || a.nombreusuario || a.email || "Usuario").localeCompare(
          String(b.displayName || b.nombreusuario || b.email || "")
        )
      )
    );

    return map;
  }, [visibleUsers]);

  const rowsForTable = useMemo(() => {
    if (isAdminRole) {
      return visibleUsers;
    }

    if (isSuper) {
      return visibleUsers.filter((u) => {
        const role = normalizeRole(u.role);
        if (isSuperAdmin(role)) return true;
        if (isAdmin(role)) return true;

        const isDirectOperatorOfSuper =
          isOperador(role) &&
          String(u.parentUserId || "") === meUid;

        return isDirectOperatorOfSuper;
      });
    }

    return visibleUsers.filter((u) => isAdmin(u.role));
  }, [visibleUsers, isAdminRole, isSuper, meUid]);

  function openCreateModal() {
    if (!canCreateUsuarios) return;
    setOperatorParentMode("admin");
    setParentAdminUid("");
    setDespachoIdForDirectOperator("");
    setRoleToCreate("operador");
    setDespachoIdToCreate("");
    setEmail("");
    setPassword("");
    setDisplayName("");
    setMsg("");
    setOpenCreate(true);
  }

  async function createUser() {
    if (!canCreateUsuarios) return;
    setMsg("");

    if (!email || password.length < 6) {
      setMsg("Email requerido y password minimo 6 caracteres.");
      return;
    }

    if (roleToCreate === "admin") {
      if (!isSuper) {
        setMsg("Solo superadmin puede crear admins.");
        return;
      }
    }

    if (roleToCreate === "operador" && isSuper && operatorParentMode === "admin" && !parentAdminUid) {
      setMsg("Selecciona el admin del que dependera el operador.");
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        email,
        password,
        displayName: displayName || null,
      };


      if (roleToCreate === "operador") {
        if (isSuper) {
          if (operatorParentMode === "admin") {
            payload.parentUserId = parentAdminUid;
            payload.parentRole = "admin";
          } else {
            payload.parentUserId = meUid;
            payload.parentRole = "superadmin";
          }
        } else {
          payload.parentUserId = meUid;
          payload.parentRole = "admin";
        }
      }

      const res: any = roleToCreate === "admin"
        ? await createAdminUser(payload)
        : await createOperadorUser(payload);

      const createdUserFolio = String(
        res?.userFolio ||
        (Number(res?.userNumber || 0) > 0
          ? `U${String(Number(res.userNumber)).padStart(2, "0")}`
          : "")
      ).trim();
      setMsg(`Creado: ${roleToCreate}${createdUserFolio ? ` ${createdUserFolio}` : ""}`);
      setOpenCreate(false);
      await refresh();
    } catch (e: any) {
      setMsg(`Error creando: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(target: UserItem) {
    if (!canActivateUsuarios) return;
    setMsg("");
    setLoading(true);
    try {
      await updateUserActive(target.uid, !target.isActive);
      await refresh();
    } catch (e: any) {
      setMsg(`Error actualizando estado: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  async function softDeleteUser(target: UserItem) {
    if (!canActivateUsuarios) return;
    const ok = window.confirm(
      `Seguro que deseas eliminar a ${target.displayName || target.email || target.uid}?` +
      `\n\nEsto lo ocultara del flujo normal, pero NO borrara historial ni movimientos.`
    );
    if (!ok) return;

    setMsg("");
    setLoading(true);
    try {
      await softDeleteUserById(target.uid);
      await refresh();
      setMsg("Usuario eliminado logicamente.");
    } catch (e: any) {
      setMsg(`Error eliminando: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  async function restoreUser(target: UserItem) {
    if (!canActivateUsuarios) return;
    setMsg("");
    setLoading(true);
    try {
      await restoreUserById(target.uid);
      await refresh();
      setMsg("Usuario reactivado correctamente.");
    } catch (e: any) {
      setMsg(`Error reactivando: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  if (!canViewUsuarios) {
    return <NoAccess as="main" className="p-6 text-slate-400" message="No tienes acceso a Usuarios." />;
  }

  return (
    <main className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-slate-100 text-2xl font-semibold">Usuarios</div>
        </div>

        <div className="flex items-center gap-2">
                    {isSuper && (
            <button
              onClick={async () => {
                if (!isSuper) return;

                const ok = window.confirm("Reparar numeracion canonica de usuarios? Esto renumerara usuarios del root actual.");
                if (!ok) return;

                setMsg("");
                setRepairingNumbers(true);

                try {
                  const res: any = await repairUserNumbersByRoot();
                  setMsg(`Numeracion reparada. Usuarios: ${res?.totalUsers ?? res?.repaired ?? 0}.`);
                  await refresh();
                } catch (e: any) {
                  setMsg(`Error reparando numeracion: ${e?.code || ""} ${e?.message || e}`);
                } finally {
                  setRepairingNumbers(false);
                }
              }}
              disabled={loading || repairingNumbers}
              className="px-4 py-2 rounded-xl bg-emerald-500/15 border border-emerald-400/30 hover:bg-emerald-500/20 text-emerald-100 font-semibold disabled:opacity-60"
            >
              {repairingNumbers ? "Reparando..." : "Reparar U00"}
            </button>
          )}

          {canCreateUsuarios && (
          <button
            onClick={openCreateModal}
            className="px-4 py-2 rounded-xl bg-sky-500/20 border border-sky-400/30 hover:bg-sky-500/25 text-sky-100 font-semibold"
          >
            + Nuevo usuario
          </button>
        )}

          <div className="flex items-center rounded-xl border border-white/10 bg-white/5 overflow-hidden">
            <button
              onClick={() => setView("table")}
              className={cx("px-3 py-2 text-sm", view === "table" ? "bg-white/10 text-white" : "text-slate-300 hover:text-white")}
            >
              Tabla
            </button>
            <button
              onClick={() => setView("cards")}
              className={cx("px-3 py-2 text-sm", view === "cards" ? "bg-white/10 text-white" : "text-slate-300 hover:text-white")}
            >
              Cards
            </button>
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
          <div className="md:col-span-6">
            <label className="block text-slate-300 text-sm mb-1">Buscar</label>
            <input
              className={InputClass}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="nombre o email..."
            />
            <div className="text-slate-500 text-xs mt-1">Resultados: {visibleUsers.length}</div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-slate-300 text-sm mb-1">Rol</label>
            <UiSelect
              value={roleFilter}
              onChange={(value) => setRoleFilter(value as any)}
              options={[
                { value: "all", label: "Todos" },
                { value: "admin", label: "Admin" },
                { value: "operador", label: "Operador" },
              ]}
              placeholder="Rol"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-slate-300 text-sm mb-1">Estado</label>
            <UiSelect
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as any)}
              options={[
                { value: "active", label: "Activos" },
                { value: "inactive", label: "Inactivos" },
                { value: "all", label: "Todos" },
              ]}
              placeholder="Estado"
            />
          </div>
        </div>
      </div>

      {view === "table" ? (
        <div className="pay0-table-card mt-6">
          <div className="pay0-table-wrap">
            <table className="pay0-table min-w-[1150px]">
              <thead>
                <tr className="pay0-table-head-row">
                  <th className="pay0-th">ID</th>
                  <th className="pay0-th">Nombre</th>
                  <th className="pay0-th">Email</th>
                  <th className="pay0-th">Rol</th>
                  {!isAdminRole && <th className="pay0-th">Operadores</th>}
                  <th className="pay0-th-right">ACC.</th>
                </tr>
              </thead>

              <tbody>
                {rowsForTable.map((a, index) => {
                  const isAdm = isAdmin(a.role);
                  const ops = isAdm ? opsByAdmin.get(a.uid) || [] : [];
                  const opsCount = ops.length;
                  const expanded = expandedAdminUid === a.uid;

                  return (
                    <React.Fragment key={a.uid}>
                      <tr className={index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}>
                        <td className="pay0-td text-sky-300">{formatUserNumber(a)}</td>
                        <td className="pay0-td text-white">{a.displayName || a.nombreusuario || a.email || "Usuario"}</td>
                        <td className="pay0-td text-slate-300">{a.email || "---"}</td>
                        <td className="pay0-td">
                          <span className={cx("inline-flex items-center px-2 py-1 rounded-lg border text-xs", roleBadge(String(a.role || "")))}>
                            {normalizeRole(String(a.role || "")) || "---"}
                          </span>
                        </td>

                        {!isAdminRole && (
                          <td className="pay0-td">
                            {isAdm ? (
                              opsCount > 0 ? (
                                <button
                                  onClick={() => setExpandedAdminUid(expanded ? "" : a.uid)}
                                  className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] font-normal text-slate-100 hover:bg-white/15"
                                >
                                  {opsCount}
                                </button>
                              ) : (
                                <span className="text-[13px] font-normal text-slate-400">{opsCount}</span>
                              )
                            ) : (
                              <span className="text-slate-400">---</span>
                            )}
                          </td>
                        )}

                        <td className="pay0-td text-right">
                          <div className="inline-flex items-center gap-2">{isSuper && !a.isDeleted && (
                              <Link
                                href={`/usuarios/${a.uid}/iq`}
                                className={actionIconClass("iq")}
                                title="Cuenta IQ"
                                aria-label={`Cuenta IQ de ${a.displayName || a.nombreusuario || a.email || "Usuario"}`}
                              >
                                IQ
                              </Link>
                            )}

                            {!a.isDeleted && canCostsUsuarios && (
                              <Link
                                href={`/usuarios/${a.uid}/costos`}
                                className={actionIconClass("costos")}
                                title="Costos"
                                aria-label="Costos"
                              >
                                <CircleDollarSign size={16} />
                              </Link>
                            )}

                            {!a.isDeleted && canClientDelegationsUsuarios && (
                              <button
                                type="button"
                                onClick={() => setOpenClientAccessUid(a.uid)}
                                className={actionIconClass("clientes")}
                                title="Clientes autorizados"
                                aria-label="Clientes autorizados"
                              >
                                <UsersRound size={16} />
                              </button>
                            )}

                            {!a.isDeleted && canPermissionsUsuarios && (
                              <button
                                type="button"
                                onClick={() => setOpenPermsUid(a.uid)}
                                className={actionIconClass("permisos")}
                                title="Permisos"
                                aria-label="Permisos"
                              >
                                <Settings2 size={16} />
                              </button>
                            )}

                            {!a.isDeleted ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => toggleActive(a)}
                                  disabled={loading}
                                  className={actionIconClass(a.isActive ? "off" : "on")}
                                  title={a.isActive ? "Desactivar" : "Activar"}
                                  aria-label={a.isActive ? "Desactivar" : "Activar"}
                                >
                                  {a.isActive ? <PowerOff size={16} /> : <Power size={16} />}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => softDeleteUser(a)}
                                  disabled={loading}
                                  className={actionIconClass("delete")}
                                  title="Eliminar"
                                  aria-label="Eliminar"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => restoreUser(a)}
                                disabled={loading}
                                className={actionIconClass("restore")}
                                title="Reactivar"
                                aria-label="Reactivar"
                              >
                                <RotateCcw size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {!isAdminRole && isAdm && expanded && (
                        <tr className="border-b border-white/10 bg-white/[0.02]">
                          <td colSpan={7} className="pay0-td">
                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                              <div className="mb-2 text-[13px] font-normal text-slate-100">
                                Operadores de {a.displayName || a.email || "Usuario"}
                              </div>

                              <div className="grid gap-2">
                                {ops.map((o) => (
                                  <div key={o.uid} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-2 text-[13px] font-normal">
                                    <div>
                                      <div className="text-slate-100">{o.displayName || o.nombreusuario || o.email || "Operador"}</div>
                                      <div className="text-[12px] font-normal text-slate-500">{o.email || ""}</div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                      <span className={cx("inline-flex items-center rounded-lg border px-2 py-1 text-[11px] font-normal", roleBadge(String(o.role || "")))}>
                                        Operador
                                      </span>{isSuper && !o.isDeleted && (
                                        <Link
                                          href={`/usuarios/${o.uid}/iq`}
                                          className={actionIconClass("iq")}
                                          title="Cuenta IQ"
                                          aria-label={`Cuenta IQ de ${o.displayName || o.nombreusuario || o.email || "Usuario"}`}
                                        >
                                          IQ
                                        </Link>
                                      )}

                                      {!o.isDeleted && canCostsUsuarios && (
                                        <Link
                                          href={`/usuarios/${o.uid}/costos`}
                                          className={actionIconClass("costos")}
                                          title="Costos"
                                          aria-label="Costos"
                                        >
                                          <CircleDollarSign size={16} />
                                        </Link>
                                      )}

                                      {!o.isDeleted && canClientDelegationsUsuarios && (
                                        <button
                                          type="button"
                                          onClick={() => setOpenClientAccessUid(o.uid)}
                                          className={actionIconClass("clientes")}
                                          title="Clientes autorizados"
                                          aria-label="Clientes autorizados"
                                        >
                                          <UsersRound size={16} />
                                        </button>
                                      )}

                                      {!o.isDeleted && canPermissionsUsuarios && (
                                        <button
                                          type="button"
                                          onClick={() => setOpenPermsUid(o.uid)}
                                          className={actionIconClass("permisos")}
                                          title="Permisos"
                                          aria-label="Permisos"
                                        >
                                          <Settings2 size={16} />
                                        </button>
                                      )}

                                      {!o.isDeleted ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => toggleActive(o)}
                                            disabled={loading}
                                            className={actionIconClass(o.isActive ? "off" : "on")}
                                            title={o.isActive ? "Desactivar" : "Activar"}
                                            aria-label={o.isActive ? "Desactivar" : "Activar"}
                                          >
                                            {o.isActive ? <PowerOff size={16} /> : <Power size={16} />}
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => softDeleteUser(o)}
                                            disabled={loading}
                                            className={actionIconClass("delete")}
                                            title="Eliminar"
                                            aria-label="Eliminar"
                                          >
                                            <Trash2 size={16} />
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() => restoreUser(o)}
                                          disabled={loading}
                                          className={actionIconClass("restore")}
                                          title="Reactivar"
                                          aria-label="Reactivar"
                                        >
                                          <RotateCcw size={16} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}

                                {ops.length === 0 && (
                                  <div className="text-slate-400 text-sm">Este admin no tiene operadores.</div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {rowsForTable.length === 0 && (
                  <tr>
                    <td colSpan={7} className="pay0-empty-cell">
                      Sin resultados con esos filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {rowsForTable.map((a) => {
            const isAdm = isAdmin(a.role);
            const ops = isAdm ? opsByAdmin.get(a.uid) || [] : [];
            const expanded = expandedAdminUid === a.uid;

          
  async function repairNumbers() {
    if (!isSuper) return;

    const ok = window.confirm("Reparar numeracion canonica de usuarios? Esto renumerara usuarios del root actual.");
    if (!ok) return;

    setMsg("");
    setRepairingNumbers(true);

    try {
      const res: any = await repairUserNumbersByRoot();
      setMsg(`Numeracion reparada. Usuarios: ${res?.totalUsers ?? res?.repaired ?? 0}.`);
      await refresh();
    } catch (e: any) {
      setMsg(`Error reparando numeracion: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setRepairingNumbers(false);
    }
  }
  return (
              <div key={a.uid} className="p-4 rounded-2xl bg-white/5 border border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sky-300 text-xs font-semibold">{formatUserNumber(a)}</div>
                    <div className="text-slate-100 font-semibold text-lg">{a.displayName || a.nombreusuario || a.email || "Usuario"}</div>
                    <div className="text-slate-400 text-sm">{a.email || ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cx("inline-flex items-center px-2 py-1 rounded-lg border text-xs", roleBadge(String(a.role || "")))}>
                      {normalizeRole(String(a.role || "")) || "---"}
                    </span>
                    <span className={cx("inline-flex items-center px-2 py-1 rounded-lg border text-xs", statusBadge(!!a.isActive))}>
                      {a.isActive ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">{isSuper && !a.isDeleted && (
                              <Link
                                href={`/usuarios/${a.uid}/iq`}
                                className={actionIconClass("iq")}
                                title="Cuenta IQ"
                                aria-label={`Cuenta IQ de ${a.displayName || a.nombreusuario || a.email || "Usuario"}`}
                              >
                                IQ
                              </Link>
                            )}

                            {!a.isDeleted && canCostsUsuarios && (
                    <Link
                                href={`/usuarios/${a.uid}/costos`}
                                className={actionIconClass("costos")}
                                title="Costos"
                                aria-label="Costos"
                              >
                                <CircleDollarSign size={16} />
                              </Link>
                  )}

                  {!a.isDeleted && canClientDelegationsUsuarios && (
                              <button
                                type="button"
                                onClick={() => setOpenClientAccessUid(a.uid)}
                                className={actionIconClass("clientes")}
                                title="Clientes autorizados"
                                aria-label="Clientes autorizados"
                              >
                                <UsersRound size={16} />
                              </button>
                            )}

                            {!a.isDeleted && canPermissionsUsuarios && (
                    <button
                                type="button"
                                onClick={() => setOpenPermsUid(a.uid)}
                                className={actionIconClass("permisos")}
                                title="Permisos"
                                aria-label="Permisos"
                              >
                                <Settings2 size={16} />
                              </button>
                  )}

                  {!a.isDeleted ? (
                    <>
                      <button
                                  type="button"
                                  onClick={() => toggleActive(a)}
                                  disabled={loading}
                                  className={actionIconClass(a.isActive ? "off" : "on")}
                                  title={a.isActive ? "Desactivar" : "Activar"}
                                  aria-label={a.isActive ? "Desactivar" : "Activar"}
                                >
                                  {a.isActive ? <PowerOff size={16} /> : <Power size={16} />}
                                </button>

                      <button
                                  type="button"
                                  onClick={() => softDeleteUser(a)}
                                  disabled={loading}
                                  className={actionIconClass("delete")}
                                  title="Eliminar"
                                  aria-label="Eliminar"
                                >
                                  <Trash2 size={16} />
                                </button>
                    </>
                  ) : (
                    <button
                                type="button"
                                onClick={() => restoreUser(a)}
                                disabled={loading}
                                className={actionIconClass("restore")}
                                title="Reactivar"
                                aria-label="Reactivar"
                              >
                                <RotateCcw size={16} />
                              </button>
                  )}
                </div>

                {!isAdminRole && isAdm && (
                  <div className="mt-4">
                    <button
                      disabled={ops.length === 0}
                      onClick={() => setExpandedAdminUid(expanded ? "" : a.uid)}
                      className={cx(
                        "w-full px-3 py-2 rounded-xl border text-center font-semibold",
                        ops.length === 0
                          ? "bg-white/5 border-white/10 text-slate-400 cursor-not-allowed"
                          : "bg-sky-500/10 border-sky-400/30 hover:bg-sky-500/15 text-sky-100"
                      )}
                    >
                      <span className="font-semibold">{ops.length}</span>
                    </button>

                    {expanded && (
                      <div className="mt-3 grid gap-2">
                        {ops.map((o) => (
                          <div key={o.uid} className="p-3 rounded-xl bg-black/20 border border-white/10 flex items-center justify-between">
                            <div>
                              <div className="text-slate-100">{o.displayName || o.nombreusuario || o.email || "Operador"}</div>
                              <div className="text-[12px] font-normal text-slate-500">{o.email || ""}</div>
                              <div className="mt-2">
                                <span className={cx("inline-flex items-center rounded-lg border px-2 py-1 text-[11px] font-normal", roleBadge(String(o.role || "")))}>
                                  Operador
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">{isSuper && !o.isDeleted && (
                                        <Link
                                          href={`/usuarios/${o.uid}/iq`}
                                          className={actionIconClass("iq")}
                                          title="Cuenta IQ"
                                          aria-label={`Cuenta IQ de ${o.displayName || o.nombreusuario || o.email || "Usuario"}`}
                                        >
                                          IQ
                                        </Link>
                                      )}

                                      {!o.isDeleted && canCostsUsuarios && (
                                <Link
                                          href={`/usuarios/${o.uid}/costos`}
                                          className={actionIconClass("costos")}
                                          title="Costos"
                                          aria-label="Costos"
                                        >
                                          <CircleDollarSign size={16} />
                                        </Link>
                              )}

                              {!o.isDeleted && canClientDelegationsUsuarios && (
                                        <button
                                          type="button"
                                          onClick={() => setOpenClientAccessUid(o.uid)}
                                          className={actionIconClass("clientes")}
                                          title="Clientes autorizados"
                                          aria-label="Clientes autorizados"
                                        >
                                          <UsersRound size={16} />
                                        </button>
                                      )}

                                      {!o.isDeleted && canPermissionsUsuarios && (
                                <button
                                          type="button"
                                          onClick={() => setOpenPermsUid(o.uid)}
                                          className={actionIconClass("permisos")}
                                          title="Permisos"
                                          aria-label="Permisos"
                                        >
                                          <Settings2 size={16} />
                                        </button>
                              )}

                              {!o.isDeleted ? (
                                <>
                                  <button
                                            type="button"
                                            onClick={() => toggleActive(o)}
                                            disabled={loading}
                                            className={actionIconClass(o.isActive ? "off" : "on")}
                                            title={o.isActive ? "Desactivar" : "Activar"}
                                            aria-label={o.isActive ? "Desactivar" : "Activar"}
                                          >
                                            {o.isActive ? <PowerOff size={16} /> : <Power size={16} />}
                                          </button>

                                  <button
                                            type="button"
                                            onClick={() => softDeleteUser(o)}
                                            disabled={loading}
                                            className={actionIconClass("delete")}
                                            title="Eliminar"
                                            aria-label="Eliminar"
                                          >
                                            <Trash2 size={16} />
                                          </button>
                                </>
                              ) : (
                                <button
                                          type="button"
                                          onClick={() => restoreUser(o)}
                                          disabled={loading}
                                          className={actionIconClass("restore")}
                                          title="Reactivar"
                                          aria-label="Reactivar"
                                        >
                                          <RotateCcw size={16} />
                                        </button>
                              )}
                            </div>
                          </div>
                        ))}
                        {ops.length === 0 && <div className="text-slate-400 text-sm">Sin operadores.</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {rowsForTable.length === 0 && (
            <div className="text-slate-400">Sin resultados con esos filtros.</div>
          )}
        </div>
      )}

      <Modal open={openCreate} title="Nuevo usuario" onClose={() => setOpenCreate(false)} widthClassName="max-w-xl">
        <div className="grid gap-3">
          <label className="text-slate-300 text-sm">
            Tipo
            <UiSelect
              className="mt-1"
              value={roleToCreate}
              onChange={(value) => setRoleToCreate(value as any)}
              options={[
                { value: "operador", label: "operador" },
                ...(isSuper ? [{ value: "admin", label: "admin (solo superadmin)" }] : []),
              ]}
              placeholder="Tipo"
            />
          </label>


          {roleToCreate === "operador" && isSuper && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-300 mb-2">Dependencia</label>
                <UiSelect
                  value={operatorParentMode}
                  onChange={(value) => setOperatorParentMode(value as "admin" | "superadmin")}
                  options={[
                    { value: "admin", label: "Depende de admin" },
                    { value: "superadmin", label: "Depende directo de superadmin" },
                  ]}
                  placeholder="Dependencia"
                />
              </div>

              {operatorParentMode === "admin" && (
                <div>
                  <label className="block text-sm text-slate-300 mb-2">Admin padre</label>
                  <UiSelect
                    value={parentAdminUid}
                    onChange={(value) => setParentAdminUid(value)}
                    options={[
                      { value: "", label: "Selecciona admin" },
                      ...adminsOnly.map((a) => ({
                        value: a.uid,
                        label: a.displayName || a.nombreusuario || a.email || "Usuario",
                      })),
                    ]}
                    placeholder="Admin padre"
                  />
                </div>
              )}
            </div>
          )}

          <label className="text-slate-300 text-sm">
            Nombre (opcional)
            <input className={cx(InputClass, "mt-1")} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>

          <label className="text-slate-300 text-sm">
            Email
            <input className={cx(InputClass, "mt-1")} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@dominio.com" />
          </label>

          <label className="text-slate-300 text-sm">
            Password
            <input className={cx(InputClass, "mt-1")} value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="minimo 6" />
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={createUser}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-sky-500/20 border border-sky-400/30 hover:bg-sky-500/25 text-sky-100 font-semibold disabled:opacity-60"
            >
              {loading ? "Procesando..." : "Crear"}
            </button>
            {msg && <div className="text-slate-200 text-sm">{msg}</div>}
          </div>
        </div>
      </Modal>

      <Modal open={!!openPermsUid} title="Permisos" onClose={() => setOpenPermsUid("")} widthClassName="max-w-4xl">
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
      <Modal open={!!openClientAccessUid} title="Clientes autorizados" onClose={() => setOpenClientAccessUid("")} widthClassName="max-w-4xl">
        {openClientAccessUid ? (
          <UserClientAccessPanel
            targetUid={openClientAccessUid}
            onClose={() => setOpenClientAccessUid("")}
          />
        ) : null}
      </Modal>
    </main>
  );
}















