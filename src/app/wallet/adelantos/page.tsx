"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import NoAccess from "@/components/NoAccess";
import UiSelect, { type UiSelectOption } from "@/components/UiSelect";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { isSuperAdmin } from "@/lib/roles";
import { grantClientAdvance } from "@/services/financing";
import { listScopedClients } from "@/services/clients";
import { useGlobalLoading } from "@/components/GlobalLoading";

type ClientOption = {
  id: string;
  nombre: string;
};

export default function WalletAdelantosPage() {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const { canAccess: canViewWallet } = useModuleAccess(profile, "wallet", "adelantos");

  const isSuperadmin = useMemo(
    () => isSuperAdmin((profile as any)?.role),
    [profile]
  );

  const rootId = useMemo(
    () => (profile as any)?.rootId || (user as any)?.uid || "",
    [profile, user]
  );

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);

  const [clienteId, setClienteId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("ANTICIPACION_DISPERSION");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [empresaId, setEmpresa] = useState("");
  const [asociadoId, setAsociado] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const advanceIdempotencyKeyRef = useRef("");
  const globalLoading = useGlobalLoading();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<null | {
    advanceId: string | null;
    clienteNombre: string | null;
    amount: number;
    beforeBalance: number | null;
    afterBalance: number | null;
  }>(null);

  useEffect(() => {
    if (!canViewWallet || !isSuperadmin || !rootId || !(user as any)?.uid) { setClients([]); setLoadingClients(false); return; }
    setLoadingClients(true);
    return listScopedClients({ uid: String((user as any).uid), role: String((profile as any)?.role || ""), rootId, requiredPermission: "viewBasic" }, (rows) => {
      setClients(rows.map((client) => ({ id: client.id, nombre: client.name || client.id }))); setLoadingClients(false);
    }, () => { setClients([]); setLoadingClients(false); });
  }, [canViewWallet, isSuperadmin, rootId, user, profile]);

  const clientOptions = useMemo<UiSelectOption[]>(
    () => [
      {
        value: "",
        label: loadingClients ? "Cargando clientes..." : "Selecciona un cliente",
        disabled: true,
      },
      ...clients.map((client) => ({
        value: client.id,
        label: client.nombre,
      })),
    ],
    [clients, loadingClients]
  );

  const fieldClass =
    "w-full rounded-xl border border-white/10 bg-[#1a2336] px-3 py-2 text-sm text-white outline-none transition focus:border-sky-500/50";

  if (!canViewWallet || !isSuperadmin) {
    return <NoAccess message="No tienes acceso a Adelantos." as="main" className="min-h-screen" />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (submitLockRef.current || submitting) {
      return;
    }

    setError("");
    setSuccess(null);

    const amountNum = Number(amount);

    if (!clienteId) {
      setError("Selecciona un cliente.");
      return;
    }

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Monto invalido.");
      return;
    }

    if (!reason.trim()) {
      setError("Motivo requerido.");
      return;
    }

    try {
      submitLockRef.current = true;

      if (!advanceIdempotencyKeyRef.current) {
        const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
        const randomPart = cryptoObj?.randomUUID
          ? cryptoObj.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        advanceIdempotencyKeyRef.current = `grantClientAdvance:${randomPart}`;
      }

      setSubmitting(true);

      await globalLoading.run(undefined, async () => {
        const result = await grantClientAdvance({
          idempotencyKey: advanceIdempotencyKeyRef.current,
          clienteId,
          amount: amountNum,
          reason: reason.trim(),
          note: note.trim() || undefined,
          reference: reference.trim() || undefined,
          empresaId: empresaId.trim() || undefined,
          asociadoId: asociadoId.trim() || undefined,
        });

        setSuccess({
          advanceId: result.advanceId,
          clienteNombre: result.clienteNombre,
          amount: result.amount,
          beforeBalance: result.beforeBalance,
          afterBalance: result.afterBalance,
        });

        setAmount("");
        setNote("");
        setReference("");
        setEmpresa("");
        setAsociado("");
      });
    } catch (err: any) {
      setError(err?.message || "No se pudo crear el adelanto.");
    } finally {
      advanceIdempotencyKeyRef.current = "";
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#020b1d] text-white p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-cyan-400/80">
              Wallet
            </div>
            <h1 className="text-2xl font-semibold">Adelantos</h1>
            <p className="mt-1 text-sm text-slate-400">
              Solo superadmin. El adelanto aumenta saldo cliente y despues se liquidara con pagos conciliados.
            </p>
          </div>

          <Link
            href="/wallet"
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 hover:bg-white/[0.06]"
          >
            Volver a Wallet
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <form
            onSubmit={onSubmit}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]"
          >
            <div className="mb-4 text-sm font-semibold text-white">
              Crear adelanto
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm text-slate-300">Cliente</label>
                <UiSelect
                  value={clienteId}
                  onChange={setClienteId}
                  options={clientOptions}
                  placeholder={loadingClients ? "Cargando clientes..." : "Selecciona un cliente"}
                  disabled={loadingClients || submitting}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-300">Monto</label>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className={fieldClass}
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-300">Motivo</label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className={fieldClass}
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-300">Referencia</label>
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className={fieldClass}
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-300">Empresa</label>
                <input
                  value={empresaId}
                  onChange={(e) => setEmpresa(e.target.value)}
                  className={fieldClass}
                  placeholder="Empresa relacionada"
                  disabled={submitting}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-300">Asociado</label>
                <input
                  value={asociadoId}
                  onChange={(e) => setAsociado(e.target.value)}
                  className={fieldClass}
                  placeholder="Asociado relacionado"
                  disabled={submitting}
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm text-slate-300">Nota</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={4}
                  className={fieldClass}
                  disabled={submitting}
                />
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </div>
            ) : null}

            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
              >
                {submitting ? "Creando..." : "Crear adelanto"}
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-4 text-sm font-semibold text-white">
              Validacion rapida
            </div>

            <div className="space-y-3 text-sm text-slate-300">
              <div>Ruta de prueba: <span className="font-mono text-cyan-300">/wallet/adelantos</span></div>
              <div>Permiso inicial: <span className="text-white">solo superadmin</span></div>
              <div>Accion backend: <span className="text-white">grantClientAdvance</span></div>
            </div>

            {success ? (
              <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="text-sm font-semibold text-emerald-300">
                  Adelanto creado
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-200">
                  <div>Cliente: {success.clienteNombre || "---"}</div>
                  <div>Monto: ${success.amount.toFixed(2)}</div>
                  <div>Saldo antes: ${Number(success.beforeBalance || 0).toFixed(2)}</div>
                  <div>Saldo despues: ${Number(success.afterBalance || 0).toFixed(2)}</div>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-white/10 bg-[#061225] p-4 text-sm text-slate-400">
                Aqui te debe salir el resultado del callable para validar el adelanto antes de colgarlo al menu lateral.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}