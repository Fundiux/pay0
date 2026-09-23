"use client";

import { formatDateTime24 } from "@/lib/dateTime";

import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  TrendingUp,
  Wallet as WalletIcon,
} from "lucide-react";
import NoAccess from "@/components/NoAccess";
import { readUserWalletOverview } from "@/services/ledger";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { normalizeRole } from "@/lib/roles";
import WalletNavigation from "@/components/WalletNavigation";

type WalletMovement = {
  id: string;
  createdAt?: any;
  movementType?: string;
  direction?: "IN" | "OUT";
  amount?: number;
  note?: string | null;
  holderName?: string | null;
  holderRole?: string | null;
  referenceId?: string | null;
  referenceFolio?: string | null;
  folio?: string | null;
  pagoFolio?: string | null;
  solicitudFolio?: string | null;
  dispersionFolio?: string | null;
  sourceFolio?: string | null;
  referenceType?: string | null;
  actorUsername?: string | null;
};

function getVisibleReference(m: any) {
  return formatText(
    m.referenceFolio ||
    m.folio ||
    m.pagoFolio ||
    m.solicitudFolio ||
    m.dispersionFolio ||
    m.sourceFolio ||
    m.referenceId
  );
}
function formatMoney(value: number) {
  return `$${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatText(value: unknown, fallback = "---") {
  const raw = String(value || "").trim();
  return raw || fallback;
}

function formatMovementType(value: unknown) {
  const raw = String(value || "MOVIMIENTO").trim();
  return raw ? raw.replace(/_/g, " ") : "MOVIMIENTO";
}

function formatReferenceType(value: unknown) {
  const raw = String(value || "").trim();
  return raw ? raw.replace(/_/g, " ") : "---";
}

function formatRole(value: unknown) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "superadmin") return "SUPERADMIN";
  if (raw === "admin") return "ADMIN";
  if (raw === "operador") return "OPERADOR";
  return "---";
}

export default function WalletEstadoCuentaUsuarioPage() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const { canAccess: canViewWalletUser } = useModuleAccess(profile, "wallet", "estadoCuentaUsuario");

  const role = normalizeRole((profile as any)?.role);
  const uid = String(user?.uid || "");
  const rootId = useMemo(
    () => String((profile as any)?.rootId || uid || ""),
    [profile, uid]
  );

  const [totalBalance, setTotalBalance] = useState(0);
  const [accountsCount, setAccountsCount] = useState(0);
  const [movements, setMovements] = useState<WalletMovement[]>([]);
  const [loading, setLoading] = useState(true);

  const scope = useMemo(() => {
    if (role === "superadmin") {
      return {
        field: "rootId",
        value: rootId,
        subtitle: "Estado de cuenta usuario global",
      };
    }

    if (role === "admin") {
      return {
        field: "adminId",
        value: uid,
        subtitle: "Estado de cuenta usuario de tu universo",
      };
    }

    return {
      field: "operadorId",
      value: uid,
      subtitle: "Estado de cuenta usuario de tu universo",
    };
  }, [role, rootId, uid]);

  useEffect(() => {
    let cancelled = false;

    async function loadUserWalletOverview() {
      if (!canViewWalletUser || !uid) {
        setTotalBalance(0);
        setAccountsCount(0);
        setMovements([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const overview = await readUserWalletOverview();

        if (cancelled) return;

        setTotalBalance(Number(overview?.totalBalance || 0));
        setAccountsCount(Number(overview?.accountsCount || 0));
        setMovements((overview?.movements || []) as WalletMovement[]);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setTotalBalance(0);
          setAccountsCount(0);
          setMovements([]);
          setLoading(false);
        }
      }
    }

    loadUserWalletOverview();

    return () => {
      cancelled = true;
    };
  }, [canViewWalletUser, uid]);

  if (!canViewWalletUser) {
    return (
      <NoAccess
        className="p-6 text-slate-400"
        message="No tienes acceso al estado de cuenta usuario."
      />
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 pb-24">
      <header className="py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white uppercase tracking-widest">
              Wallet / Estado cuenta usuario
            </h1>
            <p className="text-slate-500 text-[10px] font-bold uppercase mt-1">
              {scope.subtitle}
            </p>
          </div>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border border-sky-500/20 bg-[#161d2b] p-4 md:col-span-2">
          <div className="absolute top-0 right-0 p-8 opacity-5 text-sky-400">
            <WalletIcon size={140} />
          </div>

          <div className="relative z-10">
            <div className="flex items-center gap-3 text-sky-400 mb-2">
              <TrendingUp size={20} />
              <span className="text-xs font-bold uppercase tracking-widest">
                Saldo total USER visible
              </span>
            </div>

            <div className="font-mono text-3xl font-black tracking-tighter text-white md:text-4xl">
              {formatMoney(totalBalance)}
            </div>

            <div className="mt-2 flex items-center gap-2 text-slate-400">
              <span className="text-[10px] font-bold uppercase">
                Cuentas usuario visibles: {accountsCount}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-[#161d2b] p-4">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">
            Movimientos cargados
          </div>
          <div className="font-mono text-3xl font-black text-white">
            {movements.length}
          </div>
          <div className="mt-2 text-[10px] font-bold uppercase text-slate-500">Historial visible</div>
        </div>
      </div>

      <div className="pay0-table-card">
        <div className="pay0-table-header">
          <h2 className="pay0-table-title">HISTORIAL DE MOVIMIENTOS USUARIO</h2>
          <div className="flex items-center gap-2 text-[13px] font-normal text-slate-400">
            <span>{movements.length} movimientos</span>
            <Clock size={18} className="text-slate-500" />
          </div>
        </div>

        <div className="pay0-table-wrap">
          <table className="pay0-table min-w-[1100px]">
            <thead>
              <tr className="pay0-table-head-row">
                <th className="pay0-th">Fecha</th>
                <th className="pay0-th">Usuario</th>
                <th className="pay0-th">Rol</th>
                <th className="pay0-th">Movimiento</th>
                <th className="pay0-th">Referencia operativa</th>
                <th className="pay0-th">Concepto</th>
                <th className="pay0-th-right">Monto</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="pay0-empty-cell">
                    Cargando historial usuario...
                  </td>
                </tr>
              ) : movements.length === 0 ? (
                <tr>
                  <td colSpan={7} className="pay0-empty-cell">
                    No hay movimientos de usuario en el modelo canonico.
                  </td>
                </tr>
              ) : (
                movements.map((m, index) => {
                  const isIn = m.direction === "IN";
                  const label = formatMovementType(m.movementType);
                  const note = formatText(m.note);
                  const holderName = formatText(m.holderName);
                  const referenceType = formatReferenceType(m.referenceType);
                  const referenceId = getVisibleReference(m);
                  const actorUsername = formatText(m.actorUsername);

                  return (
                    <tr
                      key={m.id}
                      className={index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}
                    >
                      <td className="pay0-td-date text-slate-400">
                        {formatDateTime24(m.createdAt, "---")}
                      </td>

                      <td className="pay0-td text-white">
                        <div>{holderName}</div>
                        <div className="mt-0.5 text-[12px] font-normal text-slate-500">
                          {actorUsername}
                        </div>
                      </td>

                      <td className="pay0-td text-slate-300">
                        {formatRole(m.holderRole)}
                      </td>

                      <td className="pay0-td">
                        <div className="flex items-center gap-2">
                          <div
                            className={`flex h-7 w-7 items-center justify-center rounded-full ${
                              isIn
                                ? "bg-emerald-500/10 text-emerald-500"
                                : "bg-rose-500/10 text-rose-500"
                            }`}
                          >
                            {isIn ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                          </div>

                          <div className="text-[13px] font-normal text-white">
                            {label}
                          </div>
                        </div>
                      </td>

                      <td className="pay0-td text-slate-400">
                        <div className="text-[13px] font-normal text-slate-300">
                          {referenceType}
                        </div>
                        <div className="mt-0.5 whitespace-nowrap font-mono text-[12px] font-normal text-slate-500" title={referenceId}>
                          {referenceId}
                        </div>
                      </td>

                      <td className="pay0-td text-slate-400">
                        {note}
                      </td>

                      <td
                        className={`pay0-td-money ${
                          isIn ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {isIn ? "+" : "-"}{formatMoney(Number(m.amount || 0))}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      <WalletNavigation />
    </div>
  );
}
