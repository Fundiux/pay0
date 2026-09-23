"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import NoAccess from "@/components/NoAccess";
import UiSelect, { type UiSelectOption } from "@/components/UiSelect";
import { db } from "@/lib/firebaseClient";
import { useUserProfile } from "@/lib/useUserProfile";
import { createOperationType } from "@/services/rates";

type BaseType = "TOTAL" | "SUBTOTAL";
type PricingMode = "PERCENT" | "FIXED";
type OperationCategory = "OPERACION" | "DISPERSION";

const H4_D82_A2_A1_CANONICAL_DISPERSION_TYPES = [
  {
    key: "TRANSFERENCIA",
    name: "TRANSFERENCIA",
  },
  {
    key: "TDC",
    name: "TDC",
  },
  {
    key: "EFECTIVO",
    name: "EFECTIVO",
  },
] as const;

type OperationTypeRow = {
  id: string;
  key: string;
  name: string;
  aliases?: string[];
  category: OperationCategory;
  calculationBaseType: BaseType;
  pricingMode: PricingMode;
  active?: boolean;
};

function normalizeBaseType(value: unknown): BaseType {
  return String(value || "TOTAL").trim().toUpperCase() === "SUBTOTAL"
    ? "SUBTOTAL"
    : "TOTAL";
}

function normalizePricingMode(value: unknown): PricingMode {
  const normalized = String(value || "PERCENT").trim().toUpperCase();
  if (normalized === "FIXED") {
    return "FIXED";
  }
  return "PERCENT";
}

function normalizeCategory(value: unknown): OperationCategory {
  return String(value || "OPERACION").trim().toUpperCase() === "DISPERSION"
    ? "DISPERSION"
    : "OPERACION";
}

function tabCx(active: boolean) {
  return active
    ? "rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-300"
    : "rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-white/[0.06]";
}

export default function CatalogoTiposOperacionPage() {
  const { profile } = useUserProfile();

  const role = useMemo(
    () => String((profile as any)?.role || "").trim().toLowerCase(),
    [profile]
  );

  const canView = role === "superadmin";

  const [rows, setRows] = useState<OperationTypeRow[]>([]);
  const [activeCategory, setActiveCategory] = useState<OperationCategory>("OPERACION");

  const [keyValue, setKeyValue] = useState("");
  const [nameValue, setNameValue] = useState("");
  const [baseType, setBaseType] = useState<BaseType>("TOTAL");
  const [pricingMode, setPricingMode] = useState<PricingMode>("PERCENT");

  const [saving, setSaving] = useState(false);
  const [seedingDispersionTypes, setSeedingDispersionTypes] =
    useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (!canView) return;

    const q = query(collection(db, "operationTypes"), orderBy("name"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const next: OperationTypeRow[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            key: String(data.key || d.id),
            name: String(data.name || d.id),
            aliases: Array.isArray(data.aliases) ? data.aliases.map((it: any) => String(it)) : [],
            category: normalizeCategory(data.category),
            calculationBaseType: normalizeBaseType(data.calculationBaseType),
            pricingMode: normalizePricingMode(data.pricingMode),
            active: data.active !== false,
          };
        });
        setRows(next);
      },
      (err) => {
        setError(err?.message || "No se pudo leer el catalogo.");
      }
    );

    return () => unsub();
  }, [canView]);

  const filteredRows = useMemo(
    () => rows.filter((row) => row.category === activeCategory),
    [rows, activeCategory]
  );

  const baseTypeOptions = useMemo<UiSelectOption[]>(
    () => [
      { value: "TOTAL", label: "TOTAL" },
      { value: "SUBTOTAL", label: "SUBTOTAL" },
    ],
    []
  );

  const pricingModeOptions = useMemo<UiSelectOption[]>(
    () => [
      { value: "PERCENT", label: "PERCENT" },
      { value: "FIXED", label: "FIXED" },
    ],
    []
  );

  if (!canView) {
    return (
      <NoAccess
        message="No tienes acceso a Catalogo de Tipos de Operacion."
        as="main"
        className="min-h-screen"
      />
    );
  }

  async function ensureCanonicalDispersionTypes() {
    setError("");
    setSuccess("");

    const existingKeys = new Set(
      rows.map((row) =>
        String(row.key || "")
          .trim()
          .toUpperCase(),
      ),
    );

    const missing =
      H4_D82_A2_A1_CANONICAL_DISPERSION_TYPES.filter(
        (item) => !existingKeys.has(item.key),
      );

    if (missing.length === 0) {
      setSuccess(
        "TRANSFERENCIA, TDC y EFECTIVO ya existen.",
      );
      return;
    }

    try {
      setSeedingDispersionTypes(true);

      for (const item of missing) {
        await createOperationType({
          key: item.key,
          name: item.name,
          category: "DISPERSION",
          calculationBaseType: "TOTAL",
          pricingMode: "PERCENT",
          active: true,
          requiresConciliation: true,
          generatesClientBalance: false,
          generatesUserEarnings: false,
          allowsDispersion: true,
          allowsReturn: true,
        });
      }

      setSuccess(
        `Tipos creados: ${missing
          .map((item) => item.key)
          .join(", ")}.`,
      );
    } catch (err: any) {
      setError(
        err?.message ||
          "No se pudieron crear los tipos base.",
      );
    } finally {
      setSeedingDispersionTypes(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!keyValue.trim()) {
      setError("La clave es obligatoria.");
      return;
    }

    if (!nameValue.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }

    try {
      setSaving(true);

      await createOperationType({
        key: keyValue.trim(),
        name: nameValue.trim(),
        category: activeCategory,
        calculationBaseType: baseType,
        pricingMode,
        active: true,
        requiresConciliation: true,
        generatesClientBalance: true,
        generatesUserEarnings: true,
        allowsDispersion: true,
        allowsReturn: true,
      });

      setSuccess(
        activeCategory === "OPERACION"
          ? "Tipo de operacion creado."
          : "Tipo de dispersion creado."
      );

      setKeyValue("");
      setNameValue("");
      setBaseType("TOTAL");
      setPricingMode("PERCENT");
      setFormOpen(false);
    } catch (err: any) {
      setError(err?.message || "No se pudo crear el tipo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#020b1d] p-3 text-white sm:p-4">
      <div className="mx-auto w-full">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-cyan-400/80">
              Catalogos / Tipos de operacion
            </div>
            <h1 className="text-lg font-semibold">Tipos de operacion</h1>
          </div>

          <button type="button" onClick={() => setFormOpen((value) => !value)} aria-expanded={formOpen} className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/20">{formOpen ? "Cerrar alta" : "+ Nuevo tipo"}</button>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveCategory("OPERACION")}
            className={tabCx(activeCategory === "OPERACION")}
          >
            Operacion
          </button>
          <button
            type="button"
            onClick={() => setActiveCategory("DISPERSION")}
            className={tabCx(activeCategory === "DISPERSION")}
          >
            Dispersion
          </button>

          {activeCategory === "DISPERSION" ? (
            <button
              type="button"
              onClick={ensureCanonicalDispersionTypes}
              disabled={seedingDispersionTypes}
              className="ml-auto rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200 disabled:opacity-60"
            >
              {seedingDispersionTypes
                ? "Creando..."
                : "Asegurar Transferencia, TDC y Efectivo"}
            </button>
          ) : null}
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

        <div className="space-y-4">
          {formOpen ? <form onSubmit={onCreate} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="mb-4 text-sm font-semibold">
              Alta de tipo de {activeCategory === "OPERACION" ? "operacion" : "dispersion"}
            </div>
            <div className="mb-3 text-xs text-slate-400">
              La clave se normaliza en backend. Cada tipo pertenece a un grupo del catalogo central.
            </div>

            <div className="mb-4 rounded-xl border border-white/10 bg-[#061225] p-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">Grupo</div>
              <div className="mt-1 text-sm text-slate-100">{activeCategory}</div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm text-slate-300">Clave</label>
                <input
                  value={keyValue}
                  onChange={(e) => setKeyValue(e.target.value)}
                  placeholder={activeCategory === "OPERACION" ? "FACTURA_SUBTOTAL" : "TRANSFERENCIA"}
                  className="w-full rounded-xl border border-white/10 bg-[#061225] px-3 py-2 text-sm text-white outline-none"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-300">Nombre</label>
                <input
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  placeholder={activeCategory === "OPERACION" ? "Facturacion Subtotal" : "Transferencia"}
                  className="w-full rounded-xl border border-white/10 bg-[#061225] px-3 py-2 text-sm text-white outline-none"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-300">Base</label>
                <UiSelect
                  value={baseType}
                  options={baseTypeOptions}
                  placeholder="TOTAL"
                  onChange={(v) => setBaseType(v as BaseType)}
                  disabled={saving}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-300">Modo</label>
                <UiSelect
                  value={pricingMode}
                  options={pricingModeOptions}
                  placeholder="PERCENT"
                  onChange={(v) => setPricingMode(v as PricingMode)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
              >
                {saving ? "Guardando..." : activeCategory === "OPERACION" ? "Crear tipo de operacion" : "Crear tipo de dispersion"}
              </button>
            </div>
          </form> : null}

          <section className="pay0-table-card">
            <div className="pay0-table-header">
              <h2 className="pay0-table-title">CATALOGO ACTUAL DE {activeCategory === "OPERACION" ? "OPERACION" : "DISPERSION"}</h2>
              <span className="text-[13px] font-normal text-slate-400">{filteredRows.length} registros</span>
            </div>

            {filteredRows.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-[#061225] px-4 py-6 text-sm text-slate-400">
                Aun no hay tipos en este catalogo.
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-white/10">
                <div className="grid grid-cols-12 gap-2 bg-white/5 px-4 py-3 text-[11px] uppercase tracking-wide text-slate-400">
                  <div className="col-span-3">Clave</div>
                  <div className="col-span-3">Nombre</div>
                  <div className="col-span-2">Base</div>
                  <div className="col-span-2">Modo</div>
                  <div className="col-span-2">Activo</div>
                </div>

                {filteredRows.map((row, index) => (
                  <div key={row.id} className={`min-h-[38px] px-3 py-1.5 text-[13px] font-normal transition-colors ${index % 2 === 0 ? "pay0-row-even" : "pay0-row-odd"}`}>
                    <div className="grid grid-cols-12 items-center gap-2">
                      <div className="col-span-3 flex items-center truncate text-[13px] font-normal text-slate-100">{row.key}</div>
                      <div className="col-span-3 flex items-center truncate text-[13px] font-normal text-slate-100">{row.name}</div>
                      <div className="col-span-2 flex items-center text-[13px] font-normal text-slate-300">{row.calculationBaseType}</div>
                      <div className="col-span-2 flex items-center text-[13px] font-normal text-slate-300">{row.pricingMode}</div>
                      <div className="col-span-2 flex items-center text-[13px] font-normal text-slate-300">{row.active !== false ? "Activo" : "Inactivo"}</div>
                    </div>

                    {row.aliases && row.aliases.length > 0 ? (
                      <div className="mt-1 text-[12px] font-normal text-slate-500">
                        Aliases: {row.aliases.join(", ")}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}



