"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  TrendingUp,
  Wallet as WalletIcon,
} from "lucide-react";
import NoAccess from "@/components/NoAccess";
import { readClientWalletOverview } from "@/services/ledger";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { normalizeRole } from "@/lib/roles";

type WalletMovement = {
  id: string;
  createdAt?: any;
  movementType?: string;
  direction?: "IN" | "OUT";
  amount?: number;
  note?: string | null;
  holderName?: string;
  clienteId?: string | null;
  referenceId?: string | null;
};

function formatMoney(value: number) {
  return `$${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatMovementType(value: unknown) {
  const raw = String(value || "MOVIMIENTO").trim();
  return raw ? raw.replace(/_/g, " ") : "MOVIMIENTO";
}

export default function WalletPage() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const { canAccess: canViewWallet } = useModuleAccess(profile, "wallet", "saldos");

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
        subtitle: "Vista global de Wallet",
      };
    }

    if (role === "admin") {
      return {
        field: "adminId",
        value: uid,
        subtitle: "Wallet de tu universo",
      };
    }

    return {
      field: "operadorId",
      value: uid,
      subtitle: "Wallet de tu universo",
    };
  }, [role, rootId, uid]);

  useEffect(() => {
    let cancelled = false;

    async function loadWalletOverview() {
      if (!canViewWallet || !uid) {
        setTotalBalance(0);
        setAccountsCount(0);
        setMovements([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      try {
        const overview = await readClientWalletOverview();

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

    loadWalletOverview();

    return () => {
      cancelled = true;
    };
  }, [canViewWallet, uid]);

  if (!canViewWallet) {
    return <NoAccess className="p-6 text-slate-400" message="No tienes acceso a Wallet." />;
  }

  return (
    <div className="w-[95%] mx-auto pb-10">
      <header className="py-8">
        <h1 className="text-2xl font-bold text-white uppercase tracking-widest">
          Wallet
        </h1>
        <p className="text-slate-500 text-[10px] font-bold uppercase mt-1">
          {scope.subtitle}
        </p>
        <p className="text-slate-600 text-[10px] font-bold uppercase mt-2">
          Fuente canonica: balanceAccounts + balanceMovements / CLIENT
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="bg-[#161d2b] p-10 rounded-[2.5rem] border-2 border-sky-500/20 shadow-2xl relative overflow-hidden md:col-span-2">
          <div className="absolute top-0 right-0 p-8 opacity-5 text-sky-400">
            <WalletIcon size={140} />
          </div>

          <div className="relative z-10">
            <div className="flex items-center gap-3 text-sky-400 mb-2">
              <TrendingUp size={20} />
              <span className="text-xs font-bold uppercase tracking-widest">
                Saldo total visible
              </span>
            </div>

            <div className="text-6xl md:text-7xl font-black text-white font-mono tracking-tighter">
              {formatMoney(totalBalance)}
            </div>

            <div className="flex items-center gap-2 mt-6 text-slate-400">
              <span className="text-[10px] font-bold uppercase">
                Cuentas cliente visibles: {accountsCount}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-[#161d2b] p-6 rounded-[2rem] border-2 border-white/5 shadow-2xl">
          <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">
            Movimientos cargados
          </div>
          <div className="text-4xl font-black text-white font-mono">
            {movements.length}
          </div>
          <div className="mt-4 text-[10px] uppercase font-bold text-slate-500">
            Solo holderType CLIENT / USER en /wallet/estado-cuenta-usuario
          </div>
        </div>
      </div>

      <div className="bg-[#161d2b] rounded-3xl border-2 border-white/5 overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/10 bg-white/5 flex justify-between items-center">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest">
            Historial de movimientos
          </h2>
          <Clock size={18} className="text-slate-500" />
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-slate-500 text-[10px] uppercase font-bold tracking-widest border-b border-white/10">
              <th className="p-4">Fecha</th>
              <th className="p-4 text-center">Tipo</th>
              <th className="p-4">Concepto</th>
              <th className="p-4 text-right">Monto</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="p-10 text-center text-slate-500 text-xs italic">
                  Cargando historial...
                </td>
              </tr>
            ) : movements.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-10 text-center text-slate-500 text-xs italic">
                  No hay movimientos en el modelo canonico.
                </td>
              </tr>
            ) : (
              movements.map((m) => {
                const isIn = m.direction === "IN";
                const label = formatMovementType(m.movementType);
                const note = String(m.note || "").trim();
                const holderName = String(m.holderName || "").trim();
                const referenceId = String(m.referenceId || "").trim();

                return (
                  <tr key={m.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                    <td className="p-4 text-slate-400 text-[11px] font-mono">
                      {m.createdAt?.seconds
                        ? new Date(m.createdAt.seconds * 1000).toLocaleString("es-MX")
                        : "---"}
                    </td>

                    <td className="p-4 text-center">
                      <div
                        className={`mx-auto w-8 h-8 rounded-full flex items-center justify-center ${
                          isIn
                            ? "bg-emerald-500/10 text-emerald-500"
                            : "bg-rose-500/10 text-rose-500"
                        }`}
                      >
                        {isIn ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                      </div>
                    </td>

                    <td className="p-4">
                      <div className="uppercase text-[10px] font-bold text-white">
                        {label}
                      </div>

                      {note ? (
                        <div className="text-[11px] text-slate-400 mt-1">
                          {note}
                        </div>
                      ) : null}

                      <div className="text-[10px] text-slate-500 mt-1 uppercase">
                        {holderName || "---"}
                        {referenceId ? ` · Ref ${referenceId}` : ""}
                      </div>
                    </td>

                    <td
                      className={`p-4 text-right font-mono font-bold ${
                        isIn ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {isIn ? "+" : "-"}
                      {formatMoney(Number(m.amount || 0))}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}