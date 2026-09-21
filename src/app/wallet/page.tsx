"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Landmark,
  Send,
  TrendingUp,
  Users,
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
  const { canAccess: canViewClients } = useModuleAccess(profile, "wallet", "estadoCuentaCliente");
  const { canAccess: canViewUserStatement } = useModuleAccess(profile, "wallet", "estadoCuentaUsuario");
  const { canAccess: canManageDispersions } = useModuleAccess(profile, "wallet", "dispersiones");
  const { canAccess: canManageBeneficiaries } = useModuleAccess(profile, "wallet", "beneficiarios");

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
        <p className="text-slate-600 text-[10px] font-bold uppercase mt-2">Resumen operativo de saldos y movimientos</p>
      </header>

      <section className="mb-6 rounded-2xl border border-white/10 bg-[#161d2b] p-3 shadow-xl shadow-black/10">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {canViewClients && <WalletShortcut href="/wallet/clientes" icon={<Users size={17} />} title="Saldos de clientes" description="Cuentas, movimientos y adelantos." />}
          {canViewUserStatement && <WalletShortcut href="/wallet/estado-cuenta-usuario" icon={<Landmark size={17} />} title="Saldos de usuarios" description="Utilidades y estado de cuenta." />}
          {canManageDispersions && <WalletShortcut href="/wallet/dispersiones" icon={<Send size={17} />} title="Dispersiones" description="Crear y consultar salidas." />}
          {canManageBeneficiaries && <WalletShortcut href="/wallet/beneficiarios" icon={<Users size={17} />} title="Beneficiarios" description="Cuentas destino de clientes." />}
        </div>
      </section>

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

      <div className="pay0-table-card">
        <div className="pay0-table-header">
          <div>
            <h2 className="pay0-table-title">Historial reciente de clientes</h2>
            <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">Consulta el detalle completo desde Saldos de clientes.</p>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-slate-400"><span>{movements.length} movimientos</span><Clock size={17} className="text-slate-500" /></div>
        </div>
        <div className="pay0-table-wrap">
        <table className="pay0-table min-w-[760px]">
          <thead>
            <tr className="pay0-table-head-row">
              <th className="pay0-th">Fecha</th>
              <th className="pay0-th">Tipo</th>
              <th className="pay0-th">Concepto</th>
              <th className="pay0-th-right">Monto</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="pay0-empty-cell">
                  Cargando historial...
                </td>
              </tr>
            ) : movements.length === 0 ? (
              <tr>
                <td colSpan={4} className="pay0-empty-cell">
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
                  <tr key={m.id} className="pay0-table-row">
                    <td className="pay0-td-date">
                      {m.createdAt?.seconds
                        ? new Date(m.createdAt.seconds * 1000).toLocaleString("es-MX")
                        : "---"}
                    </td>

                    <td className="pay0-td">
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

                    <td className="pay0-td">
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

                    <td className={`pay0-td-amount ${
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
    </div>
  );
}

function WalletShortcut({ href, icon, title, description }: { href: string; icon: React.ReactNode; title: string; description: string }) {
  return <Link href={href} className="group flex min-h-[76px] items-center gap-3 rounded-xl border border-white/5 bg-black/10 px-4 py-3 transition hover:border-sky-400/30 hover:bg-sky-500/[0.07]">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-500/10 text-sky-300 transition group-hover:bg-sky-500/20">{icon}</span>
    <span className="min-w-0"><span className="block text-xs font-semibold text-slate-100">{title}</span><span className="mt-1 block text-[11px] leading-4 text-slate-500">{description}</span></span>
  </Link>;
}
