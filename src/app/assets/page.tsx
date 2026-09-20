"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, Plus, RefreshCw, WalletCards } from "lucide-react";
import {
  accrueAssetLoanInterest,
  createAssetPosition,
  listAssetOverview,
  recordAssetMovement,
  seedUproAssetPortfolio,
  type AssetOverview,
  type AssetPosition,
} from "@/services/assets";

const money = (minor: number) =>
  (minor / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
const today = () => new Date().toISOString().slice(0, 10);
const nonce = (prefix: string) =>
  `${prefix}:${Date.now()}:${crypto.randomUUID()}`;

export default function AssetsPage() {
  const [data, setData] = useState<AssetOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"VEHICLE" | "LOAN">("VEHICLE");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [selected, setSelected] = useState<AssetPosition | null>(null);
  const [movementType, setMovementType] = useState("VEHICLE_PRINCIPAL_RETURN");
  const [movementAmount, setMovementAmount] = useState("");
  const [source, setSource] = useState("MANUAL");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await listAssetOverview());
      setMessage("");
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar ASSETS.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!selected) return;
    setMovementType(
      selected.kind === "LOAN"
        ? "INTEREST_PAYMENT"
        : "VEHICLE_PRINCIPAL_RETURN",
    );
  }, [selected]);
  const vehiclePositions = useMemo(
    () => data?.positions.filter((item) => item.kind === "VEHICLE") || [],
    [data],
  );
  const loanPositions = useMemo(
    () => data?.positions.filter((item) => item.kind === "LOAN") || [],
    [data],
  );
  const create = async () => {
    const initialMinor = Math.round(Number(amount) * 100);
    if (
      !name.trim() ||
      !Number.isSafeInteger(initialMinor) ||
      initialMinor <= 0
    )
      return setMessage("Captura nombre y capital válido.");
    try {
      await createAssetPosition({
        kind,
        name: name.trim(),
        initialMinor,
        effectiveDate: today(),
        interestModel:
          kind === "LOAN" ? "SIMPLE_ON_OUTSTANDING_PRINCIPAL" : undefined,
        rateBasisPoints:
          kind === "LOAN" ? Math.round(Number(rate || 0) * 100) : undefined,
        paymentRule: "MANUAL",
        idempotencyKey: nonce("position"),
      });
      setName("");
      setAmount("");
      setRate("");
      setMessage("Posición creada y apertura registrada en el ledger.");
      await load();
    } catch (error: any) {
      setMessage(error?.message || "No se pudo crear la posición.");
    }
  };
  const record = async () => {
    if (!selected) return;
    const amountMinor = Math.round(Number(movementAmount) * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      return setMessage("Captura un monto válido.");
    try {
      await recordAssetMovement({
        positionId: selected.id,
        movementType,
        amountMinor,
        source,
        effectiveDate: today(),
        idempotencyKey: nonce("movement"),
      });
      setMovementAmount("");
      setMessage(
        "Movimiento registrado. El saldo fue recalculado desde el ledger.",
      );
      await load();
    } catch (error: any) {
      setMessage(error?.message || "No se pudo registrar el movimiento.");
    }
  };
  const accrue = async (position: AssetPosition) => {
    const periodKey = new Date().toISOString().slice(0, 7);
    try {
      const result = await accrueAssetLoanInterest({
        positionId: position.id,
        periodKey,
      });
      setMessage(
        result.skipped
          ? "El modelo no genera interés."
          : result.duplicate
            ? "Ese periodo ya había sido procesado; no se duplicó."
            : `Interés del periodo registrado: ${money(result.amountMinor)}.`,
      );
      await load();
    } catch (error: any) {
      setMessage(error?.message || "No se pudo generar el interés.");
    }
  };
  const seedUpro = async () => {
    try {
      const result = await seedUproAssetPortfolio();
      setMessage(
        result.alreadySeeded
          ? "U-PRO ya estaba cargado; no se duplicó."
          : "U-PRO cargado con Duster, Kwid y Arkana.",
      );
      await load();
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar U-PRO.");
    }
  };
  const card = (position: AssetPosition) => (
    <button
      key={position.id}
      onClick={() => setSelected(position)}
      className={`w-full rounded-xl border p-4 text-left transition ${selected?.id === position.id ? "border-cyan-400 bg-cyan-500/10" : "border-slate-800 bg-slate-900 hover:border-slate-700"}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="font-semibold text-white">{position.name}</p>
          <p className="text-xs text-slate-500">
            {position.status} · {position.counterpartyName || "Sin contraparte"}
          </p>
        </div>
        <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-300">
          {position.kind}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-slate-500">Capital trabajando</p>
          <p className="font-semibold text-white">
            {money(position.snapshot.outstandingPrincipalMinor)}
          </p>
        </div>
        <div>
          <p className="text-slate-500">Utilidad realizada</p>
          <p className="font-semibold text-emerald-300">
            {money(position.snapshot.realizedProfitMinor)}
          </p>
        </div>
        <div>
          <p className="text-slate-500">Capital recuperado</p>
          <p className="text-sky-300">
            {money(position.snapshot.recoveredPrincipalMinor)}
          </p>
        </div>
        <div>
          <p className="text-slate-500">Interés pendiente</p>
          <p className="text-amber-300">
            {money(position.snapshot.pendingInterestMinor)}
          </p>
        </div>
      </div>
      {position.kind === "LOAN" && (
        <span
          onClick={(event) => {
            event.stopPropagation();
            void accrue(position);
          }}
          className="mt-3 inline-block rounded-lg border border-violet-500/40 px-2 py-1 text-[11px] text-violet-200"
        >
          Generar interés del mes
        </span>
      )}
    </button>
  );
  return (
    <main className="p-6 pb-28">
      <section className="rounded-2xl border border-cyan-500/20 bg-slate-950 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-cyan-300">
              PAY0 PLATFORM · ASSETS V1
            </p>
            <h1 className="text-3xl font-semibold text-white">
              Patrimonio privado
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Vehículos y préstamos explicados por movimientos. El origen del
              dinero no cambia su efecto financiero.
            </p>
          </div>
        <div className="flex gap-2">
          <button
            onClick={() => void seedUpro()}
            className="rounded-lg border border-cyan-500/40 px-3 py-2 text-xs font-semibold text-cyan-200"
          >
            Cargar U-PRO V1
          </button>
          <button
            onClick={() => void load()}
            aria-label="Actualizar patrimonio"
            className="rounded-lg border border-slate-700 p-2 text-slate-300"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} size={17} />
          </button>
        </div>
        </div>
      </section>
      {message && (
        <p className="mt-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200">
          {message}
        </p>
      )}
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Capital trabajando", data?.totals.workingMinor || 0],
          ["Capital recuperado", data?.totals.recoveredPrincipalMinor || 0],
          ["Utilidad realizada", data?.totals.realizedProfitMinor || 0],
          ["Interés pendiente", data?.totals.pendingInterestMinor || 0],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-xl border border-slate-800 bg-slate-900 p-4"
          >
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold text-white">
              {money(Number(value))}
            </p>
          </div>
        ))}
      </section>
      <section className="mt-6 grid gap-6 xl:grid-cols-[360px_1fr]">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="flex items-center gap-2 font-semibold text-white">
            <Plus size={17} /> Nueva posición
          </h2>
          <div className="mt-4 grid gap-3">
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as any)}
              className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
            >
              <option value="VEHICLE">Vehículo</option>
              <option value="LOAN">Préstamo</option>
            </select>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={
                kind === "VEHICLE"
                  ? "Duster, Kwid, Arkana…"
                  : "Nombre del préstamo"
              }
              className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
            />
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              type="number"
              min="0"
              step="0.01"
              placeholder="Capital inicial"
              className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
            />
            {kind === "LOAN" && (
              <input
                value={rate}
                onChange={(event) => setRate(event.target.value)}
                type="number"
                min="0"
                step="0.01"
                placeholder="Tasa mensual %"
                className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
              />
            )}
            <button
              onClick={() => void create()}
              className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950"
            >
              Crear posición
            </button>
          </div>
          {selected && (
            <div className="mt-6 border-t border-slate-800 pt-4">
              <h3 className="font-semibold text-white">
                Registrar movimiento · {selected.name}
              </h3>
              <div className="mt-3 grid gap-3">
                <select
                  value={movementType}
                  onChange={(event) => setMovementType(event.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                >
                  {selected.kind === "VEHICLE" ? (
                    <>
                      <option value="VEHICLE_PRINCIPAL_RETURN">
                        Retorno de capital
                      </option>
                      <option value="VEHICLE_PROFIT">Utilidad</option>
                      <option value="VEHICLE_INVESTMENT">
                        Aportación adicional
                      </option>
                    </>
                  ) : (
                    <>
                      <option value="INTEREST_PAYMENT">Pago de interés</option>
                      <option value="PRINCIPAL_PAYMENT">Abono a capital</option>
                      <option value="INTEREST_CAPITALIZED">
                        Capitalizar interés
                      </option>
                    </>
                  )}
                </select>
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                >
                  <option value="MANUAL">Manual</option>
                  <option value="CASH">Efectivo</option>
                  <option value="EXTERNAL_TRANSFER">
                    Transferencia externa
                  </option>
                  <option value="PAY0">PAY0</option>
                  <option value="OTHER">Otro</option>
                </select>
                <input
                  value={movementAmount}
                  onChange={(event) => setMovementAmount(event.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Monto"
                  className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white"
                />
                <button
                  onClick={() => void record()}
                  className="rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white"
                >
                  Registrar en ledger
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-white">
              <WalletCards size={18} /> Vehículos
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {vehiclePositions.length ? (
                vehiclePositions.map(card)
              ) : (
                <p className="text-sm text-slate-500">
                  No hay vehículos registrados.
                </p>
              )}
            </div>
          </section>
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-white">
              <Landmark size={18} /> Préstamos
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {loanPositions.length ? (
                loanPositions.map(card)
              ) : (
                <p className="text-sm text-slate-500">
                  No hay préstamos registrados.
                </p>
              )}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
