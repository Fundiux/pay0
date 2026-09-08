"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import NoAccess from "@/components/NoAccess";
import UiSelect, { type UiSelectOption } from "@/components/UiSelect";
import { db } from "@/lib/firebaseClient";
import { useUserProfile } from "@/lib/useUserProfile";
import { setDespachoOperationCost } from "@/services/rates";

type Props = {
  params: { id: string };
};

type BaseType = "TOTAL" | "SUBTOTAL";
type PricingMode = "PERCENT" | "FIXED";
type OperationCategory = "OPERACION" | "DISPERSION";

type OperationTypeRow = {
  id: string;
  key: string;
  name: string;
  category?: OperationCategory;
  calculationBaseType: BaseType;
  pricingMode: PricingMode;
  active?: boolean;
};

type CostRow = {
  id: string;
  operationTypeKey: string;
  operationTypeName: string;
  calculationBaseType: BaseType;
  pricingMode: PricingMode;
  baseCost: number;
  active?: boolean;
  notes?: string | null;
};

function normalizeBaseType(value: unknown): BaseType {
  return String(value || "TOTAL").trim().toUpperCase() === "SUBTOTAL"
    ? "SUBTOTAL"
    : "TOTAL";
}

function normalizePricingMode(value: unknown): PricingMode {
  const normalized = String(value || "PERCENT").trim().toUpperCase();
  const legacyHybridMode = ["MI", "XED"].join("");
  if (normalized === "FIXED" || normalized === legacyHybridMode) {
    return "FIXED";
  }
  return "PERCENT";
}

function normalizeCategory(value: unknown): OperationCategory {
  return String(value || "OPERACION").trim().toUpperCase() === "DISPERSION"
    ? "DISPERSION"
    : "OPERACION";
}

function formatCostDisplay(value: number, pricingMode: PricingMode): string {
  const amount = Number(value || 0);

  if (pricingMode === "PERCENT") {
    return `${amount.toFixed(4).replace(/\.?0+$/, "")}%`;
  }

  return `$${amount.toFixed(2)}`;
}

export default function DespachoCostosPage({ params }: Props) {
  const despachoId = params.id;
  const { profile } = useUserProfile();

  const role = useMemo(
    () => String((profile as any)?.role || "").trim().toLowerCase(),
    [profile]
  );

  const canView = role === "superadmin";

  const [despachoNombre, setDespachoNombre] = useState(despachoId);
  const [operationTypes, setOperationTypes] = useState<OperationTypeRow[]>([]);
  const [costRows, setCostRows] = useState<CostRow[]>([]);
  const [activeCategory, setActiveCategory] =
    useState<OperationCategory>("OPERACION");

  const [selectedOperationTypeKey, setSelectedOperationTypeKey] = useState("");
  const [baseCost, setBaseCost] = useState("");
  const [costNotes, setCostNotes] = useState("");

  // H4_D82_A2_A2_EDITABLE_DISPATCH_COSTS
  const [editingOperationTypeKey, setEditingOperationTypeKey] =
    useState("");

  const [savingCost, setSavingCost] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!despachoId || !canView) return;

    const despachoRef = doc(db, "despachos", despachoId);
    const unsubDespacho = onSnapshot(despachoRef, (snap) => {
      const data = snap.data() as any;
      if (data) {
        setDespachoNombre(String(data.nombre || data.name || despachoId));
      }
    });

    const qTypes = query(collection(db, "operationTypes"), orderBy("name"));
    const unsubTypes = onSnapshot(qTypes, (snap) => {
      const rows: OperationTypeRow[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          key: String(data.key || d.id),
          name: String(data.name || d.id),
          category: normalizeCategory(data.category),
          calculationBaseType: normalizeBaseType(data.calculationBaseType),
          pricingMode: normalizePricingMode(data.pricingMode),
          active: data.active !== false,
        };
      });
      setOperationTypes(rows);
    });

    const qCosts = query(
      collection(db, "despachos", despachoId, "costos"),
      orderBy("operationTypeName")
    );

    const unsubCosts = onSnapshot(qCosts, (snap) => {
      const rows: CostRow[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          operationTypeKey: String(data.operationTypeKey || d.id),
          operationTypeName: String(data.operationTypeName || d.id),
          calculationBaseType: normalizeBaseType(data.calculationBaseType),
          pricingMode: normalizePricingMode(data.pricingMode),
          baseCost: Number(data.baseCost || 0),
          active: data.active !== false,
          notes: data.notes || null,
        };
      });
      setCostRows(rows);
    });

    return () => {
      unsubDespacho();
      unsubTypes();
      unsubCosts();
    };
  }, [despachoId, canView]);

  const visibleOperationTypes = useMemo(
    () =>
      operationTypes.filter((it) => {
        const category = normalizeCategory(
          it.category,
        );

        return (
          category === activeCategory &&
          it.active !== false
        );
      }),
    [operationTypes, activeCategory]
  );

  const categoryByOperationTypeKey = useMemo(
    () =>
      new Map(
        operationTypes.map((item) => [
          item.key,
          normalizeCategory(item.category),
        ]),
      ),
    [operationTypes],
  );

  const visibleCostRows = useMemo(
    () =>
      costRows.filter(
        (row) =>
          (categoryByOperationTypeKey.get(
            row.operationTypeKey,
          ) || "OPERACION") === activeCategory,
      ),
    [
      costRows,
      categoryByOperationTypeKey,
      activeCategory,
    ],
  );

  const selectedOperationType = useMemo(
    () => visibleOperationTypes.find((it) => it.key === selectedOperationTypeKey) || null,
    [visibleOperationTypes, selectedOperationTypeKey]
  );

  useEffect(() => {
    setSelectedOperationTypeKey("");
    setBaseCost("");
    setCostNotes("");
    setEditingOperationTypeKey("");
  }, [activeCategory]);

  const operationTypeOptions = useMemo<UiSelectOption[]>(
    () => [
      { value: "", label: "Selecciona un tipo", disabled: true },
      ...visibleOperationTypes.map((it) => ({
        value: it.key,
        label: `${it.name} - ${it.calculationBaseType}`,
      })),
    ],
    [visibleOperationTypes]
  );

  if (!canView) {
    return (
      <NoAccess
        message="No tienes acceso a Costos de Despachos."
        as="main"
        className="min-h-screen"
      />
    );
  }

  function startEditingCost(row: CostRow) {
    setError("");
    setSuccess("");
    setSelectedOperationTypeKey(row.operationTypeKey);
    setBaseCost(String(Number(row.baseCost || 0)));
    setCostNotes(String(row.notes || ""));
    setEditingOperationTypeKey(
      row.operationTypeKey,
    );

    window.setTimeout(() => {
      document
        .getElementById("despacho-cost-form")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 0);
  }

  function cancelEditingCost() {
    setError("");
    setSuccess("");
    setSelectedOperationTypeKey("");
    setBaseCost("");
    setCostNotes("");
    setEditingOperationTypeKey("");
  }

  async function onSaveCost(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const amount = Number(baseCost);
    const isEditing = Boolean(
      editingOperationTypeKey,
    );

    if (!selectedOperationTypeKey) {
      setError("Selecciona un tipo del catalogo.");
      return;
    }

    if (!Number.isFinite(amount) || amount < 0) {
      setError(
        "Costo base invalido. Puede ser cero.",
      );
      return;
    }

    try {
      setSavingCost(true);

      await setDespachoOperationCost({
        despachoId,
        operationTypeKey: selectedOperationTypeKey,
        baseCost: amount,
        notes: costNotes.trim() || undefined,
        active: true,
      });

      setSuccess(
        isEditing
          ? "Costo de despacho actualizado."
          : "Costo de despacho guardado.",
      );
      setSelectedOperationTypeKey("");
      setBaseCost("");
      setCostNotes("");
      setEditingOperationTypeKey("");
    } catch (err: any) {
      setError(err?.message || "No se pudo guardar el costo.");
    } finally {
      setSavingCost(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#020b1d] text-white p-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-cyan-400/80">
              Despachos / Costos
            </div>
            <h1 className="text-2xl font-semibold">{despachoNombre}</h1>
            <p className="mt-1 text-sm text-slate-400">
              Aqui vive el costo base por tipo de operacion. Este costo sera la referencia
              inamovible para Usuarios y luego para Clientes.
            </p>
          </div>

          <Link
            href="/despachos"
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 hover:bg-white/[0.06]"
          >
            Volver a Despachos
          </Link>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            {success}
          </div>
        ) : null}

        <div className="mb-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() =>
              setActiveCategory("OPERACION")
            }
            className={
              activeCategory === "OPERACION"
                ? "rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200"
                : "rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-300"
            }
          >
            Operacion
          </button>
          <button
            type="button"
            onClick={() =>
              setActiveCategory("DISPERSION")
            }
            className={
              activeCategory === "DISPERSION"
                ? "rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200"
                : "rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-300"
            }
          >
            Dispersion
          </button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
          <form
            id="despacho-cost-form"
            onSubmit={onSaveCost}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"
          >
            <div className="mb-4 text-sm font-semibold">
              {editingOperationTypeKey
                ? "Editar costo base del despacho"
                : "Guardar costo base del despacho"}
            </div>
            <div className="mb-3 text-xs text-slate-400">
              Selecciona un tipo existente del catalogo central y captura solo el costo base.
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-slate-300">
                  Tipo de {activeCategory === "OPERACION" ? "operacion" : "dispersion"}
                </label>
                <UiSelect
                  value={selectedOperationTypeKey}
                  options={operationTypeOptions}
                  placeholder="Selecciona un tipo"
                  onChange={(value) => {
                    setSelectedOperationTypeKey(value);

                    if (
                      editingOperationTypeKey &&
                      value !==
                        editingOperationTypeKey
                    ) {
                      setEditingOperationTypeKey("");
                    }
                  }}
                  disabled={
                    savingCost ||
                    Boolean(editingOperationTypeKey)
                  }
                />
              </div>

              <div className="rounded-xl border border-white/10 bg-[#061225] p-4">
                <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-cyan-400/80">
                  Datos del tipo seleccionado
                </div>

                {selectedOperationType ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">Clave</div>
                      <div className="mt-1 break-words text-sm text-slate-100">
                        {selectedOperationType.key}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">Nombre</div>
                      <div className="mt-1 break-words text-sm text-slate-100">
                        {selectedOperationType.name}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">Base</div>
                      <div className="mt-1 text-sm text-slate-100">
                        {selectedOperationType.calculationBaseType}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">Modo</div>
                      <div className="mt-1 text-sm text-slate-100">
                        {selectedOperationType.pricingMode}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">
                    Los tipos de operacion se crean en Catalogos. Aqui solo seleccionas uno existente y configuras su costo.
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-300">Costo base</label>
                <input
                  value={baseCost}
                  onChange={(e) => setBaseCost(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-xl border border-white/10 bg-[#061225] px-3 py-2 text-sm text-white outline-none"
                  disabled={savingCost}
                />
                {selectedOperationType ? (
                  <div className="mt-2 text-xs text-slate-500">
                    Se guardara como{" "}
                    {selectedOperationType.pricingMode ===
                    "PERCENT"
                      ? String(Number(baseCost || 0)) + "%"
                      : "$" + Number(baseCost || 0).toFixed(2)}
                    .
                  </div>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-300">Notas</label>
                <textarea
                  value={costNotes}
                  onChange={(e) => setCostNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-white/10 bg-[#061225] px-3 py-2 text-sm text-white outline-none"
                  disabled={savingCost}
                />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              {editingOperationTypeKey ? (
                <button
                  type="button"
                  onClick={cancelEditingCost}
                  disabled={savingCost}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-200 disabled:opacity-60"
                >
                  Cancelar
                </button>
              ) : null}

              <button
                type="submit"
                disabled={savingCost}
                className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
              >
                {savingCost
                  ? "Guardando..."
                  : editingOperationTypeKey
                    ? "Actualizar costo"
                    : "Guardar costo base"}
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-4 text-sm font-semibold">Costos configurados</div>

            {visibleCostRows.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#061225] px-4 py-6 text-sm text-slate-400">
                Este despacho aun no tiene costos configurados.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-white/10">
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-12 gap-3 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-wide text-slate-400">
                    <div className="col-span-3">Tipo</div>
                    <div className="col-span-2">Base</div>
                    <div className="col-span-2">Modo</div>
                    <div className="col-span-2">Costo</div>
                    <div className="col-span-1">Activo</div>
                    <div className="col-span-2 text-right">
                      Acciones
                    </div>
                  </div>

                  {visibleCostRows.map((row) => {
                    const isEditing =
                      editingOperationTypeKey ===
                      row.operationTypeKey;

                    return (
                      <div
                        key={row.id}
                        className={[
                          "grid grid-cols-12 items-center gap-3 border-t px-4 py-3 text-sm",
                          isEditing
                            ? "border-cyan-400/30 bg-cyan-500/10"
                            : "border-white/10",
                        ].join(" ")}
                      >
                        <div className="col-span-3 break-words text-slate-100">
                          {row.operationTypeName}
                        </div>
                        <div className="col-span-2 text-slate-300">
                          {row.calculationBaseType}
                        </div>
                        <div className="col-span-2 text-slate-300">
                          {row.pricingMode}
                        </div>
                        <div className="col-span-2 text-slate-100">
                          {formatCostDisplay(
                            row.baseCost,
                            row.pricingMode,
                          )}
                        </div>
                        <div className="col-span-1 text-slate-300">
                          {row.active !== false
                            ? "Activo"
                            : "Inactivo"}
                        </div>
                        <div className="col-span-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() =>
                              startEditingCost(row)
                            }
                            disabled={savingCost}
                            className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-60"
                          >
                            {isEditing
                              ? "Editando"
                              : "Editar"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
