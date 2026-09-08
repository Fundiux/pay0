"use client";

import { formatDateTime24 } from "@/lib/dateTime";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import {
  Clock,
  ExternalLink,
  TrendingUp,
  Users,
  Wallet as WalletIcon,
} from "lucide-react";
import NoAccess from "@/components/NoAccess";
import { readClientWalletAccountsOverview } from "@/services/ledger";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { normalizeRole } from "@/lib/roles";

type BalanceAccount = {
  id: string;
  holderId?: string | null;
  holderName?: string | null;
  holderType?: string | null;
  availableBalance?: number;
  pendingAmount?: number;
  totalGranted?: number;
  netBalance?: number;
  lastMovementAt?: any;
};

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

function formatDate(value: any) {
  return formatDateTime24(value, "---");
}

export default function WalletClientesPage() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const { canAccess: canViewWalletClients } = useModuleAccess(profile, "wallet", "estadoCuentaCliente");

  const role = normalizeRole((profile as any)?.role);
  const uid = String(user?.uid || "");
  const rootId = useMemo(
    () => String((profile as any)?.rootId || uid || ""),
    [profile, uid]
  );

  const [accounts, setAccounts] = useState<BalanceAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  const scope = useMemo(() => {
    if (role === "superadmin") {
      return {
        field: "rootId",
        value: rootId,
        subtitle: "Listado global de cuentas cliente",
      };
    }

    if (role === "admin") {
      return {
        field: "adminId",
        value: uid,
        subtitle: "Listado de cuentas cliente de tu universo",
      };
    }

    return {
      field: "operadorId",
      value: uid,
      subtitle: "Listado de cuentas cliente de tu universo",
    };
  }, [role, rootId, uid]);

  useEffect(() => {
    let cancelled = false;

    async function loadClientAccounts() {
      if (!canViewWalletClients || !uid) {
        setAccounts([]);
        setLoadingAccounts(false);
        return;
      }

      setLoadingAccounts(true);

      try {
        const overview = await readClientWalletAccountsOverview();

        if (cancelled) return;

        setAccounts((overview?.accounts || []) as BalanceAccount[]);
        setLoadingAccounts(false);
      } catch {
        if (!cancelled) {
          setAccounts([]);
          setLoadingAccounts(false);
        }
      }
    }

    loadClientAccounts();

    return () => {
      cancelled = true;
    };
  }, [canViewWalletClients, uid]);

  const rows = useMemo(() => {
    return accounts
      .map((item) => {
        const holderId = String(item.holderId || "").trim();
        const saldoDisponible = Number(item.availableBalance || 0);
        const adelantoPendiente = Number(item.pendingAmount || 0);
        const saldoNeto = Number(item.netBalance || 0);
        const totalAdelantado = Number(item.totalGranted || 0);

        return {
          ...item,
          holderId,
          saldoDisponible,
          adelantoPendiente,
          saldoNeto,
          totalAdelantado,
        };
      })
      .sort((a, b) => {
        const netDiff = Number(b.saldoNeto || 0) - Number(a.saldoNeto || 0);
        if (netDiff !== 0) return netDiff;
        return String(a.holderName || "").localeCompare(String(b.holderName || ""));
      });
  }, [accounts]);

  const totalSaldoDisponible = useMemo(
    () => rows.reduce((acc, item) => acc + Number(item.saldoDisponible || 0), 0),
    [rows]
  );

  const totalAdelantoPendiente = useMemo(
    () => rows.reduce((acc, item) => acc + Number(item.adelantoPendiente || 0), 0),
    [rows]
  );

  const totalSaldoNeto = useMemo(
    () => rows.reduce((acc, item) => acc + Number(item.saldoNeto || 0), 0),
    [rows]
  );

  const loading = loadingAccounts;

  if (!canViewWalletClients) {
    return (
      <NoAccess
        className="p-6 text-slate-400"
        message="No tienes acceso a clientes wallet."
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] min-w-0 pb-10">
      <header className="py-8">
        <div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-widest">
            Wallet / Clientes
          </h1>
          <p className="text-slate-500 text-[10px] font-bold uppercase mt-1">
            {scope.subtitle}
          </p>
          <p className="text-slate-600 text-[10px] font-bold uppercase mt-2">
            Fuente visible: balanceAccounts / CLIENT + clientAdvances.pendingAmount
          </p>
        </div>
      </header>

      <div className="mb-6 grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-4 2xl:gap-6">
        <div className="relative min-w-0 overflow-hidden rounded-[2rem] border-2 border-sky-500/20 bg-[#161d2b] p-5 shadow-2xl sm:p-6 xl:col-span-2 2xl:rounded-[2.5rem] 2xl:p-8">
          <div className="absolute top-0 right-0 p-8 opacity-5 text-sky-400">
            <WalletIcon size={120} />
          </div>

          <div className="relative z-10">
            <div className="flex items-center gap-3 text-sky-400 mb-2">
              <TrendingUp size={20} />
              <span className="text-xs font-bold uppercase tracking-widest">
                Saldo disponible clientes
              </span>
            </div>

            <div className="max-w-full break-words font-mono text-4xl font-black tracking-tighter text-white sm:text-5xl 2xl:text-7xl">
              {formatMoney(totalSaldoDisponible)}
            </div>

            <div className="mt-6 text-[10px] font-bold uppercase text-slate-400">
              Cuentas cliente visibles: {rows.length}
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-[2rem] border-2 border-white/5 bg-[#161d2b] p-5 shadow-2xl sm:p-6">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">
            Adelanto pendiente visible
          </div>
          <div className="max-w-full break-words font-mono text-3xl font-black text-amber-300 sm:text-4xl">
            {formatMoney(totalAdelantoPendiente)}
          </div>
          <div className="mt-4 text-[10px] uppercase font-bold text-slate-500">
            Deuda por limpiar con pagos
          </div>
        </div>

        <div className="min-w-0 rounded-[2rem] border-2 border-white/5 bg-[#161d2b] p-5 shadow-2xl sm:p-6">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">
            Saldo neto visible
          </div>
          <div className={`max-w-full break-words font-mono text-3xl font-black sm:text-4xl ${totalSaldoNeto >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
            {formatMoney(totalSaldoNeto)}
          </div>
          <div className="mt-4 text-[10px] uppercase font-bold text-slate-500">
            Saldo disponible menos adelanto pendiente
          </div>
        </div>
      </div>

      <div className="mb-6 px-2">
        <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500">
          Regla visible canonica: dispersiones validan contra saldo disponible / pagos futuros liquidan primero comision y despues adelanto pendiente
        </div>
      </div>

      <div className="pay0-table-card">
        <div className="pay0-table-header">
          <h2 className="pay0-table-title">LISTADO DE CUENTAS CLIENTE</h2>
          <div className="flex items-center gap-2 text-[13px] font-normal text-slate-400">
            <span>{rows.length} registros</span>
            <Users size={18} className="text-slate-500" />
          </div>
        </div>

        <div className="pay0-table-wrap">
          <table className="pay0-table min-w-[1050px] xl:min-w-[1280px] 2xl:min-w-[1500px]">
            <thead>
              <tr className="pay0-table-head-row">
                <th className="pay0-th">Cliente</th>
                <th className="pay0-th-right">Saldo disponible</th>
                <th className="pay0-th-right">Adelanto pendiente</th>
                <th className="pay0-th-right">Saldo neto</th>
                <th className="pay0-th-right">Total adelantado</th>
                <th className="pay0-th">Ultimo movimiento</th>
                <th className="pay0-th-right">Detalle</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="pay0-empty-cell">
                    Cargando clientes wallet...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="pay0-empty-cell">
                    No hay cuentas cliente visibles en el modelo canonico.
                  </td>
                </tr>
              ) : (
                rows.map((item, index) => {
                  const canOpen = !!item.holderId;

                  return (
                    <tr
                      key={item.id}
                      className={index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}
                    >
                      <td className="pay0-td text-white">
                        {formatText(item.holderName)}
                      </td>

                      <td className="pay0-td-money text-white">
                        {formatMoney(Number(item.saldoDisponible || 0))}
                      </td>

                      <td className="pay0-td-money text-amber-300">
                        {formatMoney(Number(item.adelantoPendiente || 0))}
                      </td>

                      <td className={`pay0-td-money ${Number(item.saldoNeto || 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {formatMoney(Number(item.saldoNeto || 0))}
                      </td>

                      <td className="pay0-td-money text-sky-300">
                        {formatMoney(Number(item.totalAdelantado || 0))}
                      </td>

                      <td className="pay0-td-date text-slate-400">
                        <div className="flex items-center gap-2">
                          <Clock size={14} className="text-slate-500" />
                          <span>{formatDate(item.lastMovementAt)}</span>
                        </div>
                      </td>

                      <td className="pay0-td text-right">
                        {canOpen ? (
                          <Link
                            href={`/wallet/clientes/${encodeURIComponent(item.holderId)}`}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-2.5 py-1 text-[10px] font-normal uppercase text-slate-200 transition-colors hover:bg-white/5"
                          >
                            <ExternalLink size={14} />
                            Ver detalle
                          </Link>
                        ) : (
                          <span className="text-[10px] font-normal uppercase text-slate-600">
                            Sin detalle
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
