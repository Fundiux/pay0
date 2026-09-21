"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import NoAccess from "@/components/NoAccess";
import UiSelect, { type UiSelectOption } from "@/components/UiSelect";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { isAdmin, isOperador, isSuperAdmin, normalizeRole } from "@/lib/roles";
import { setClientOperationCost } from "@/services/rates";
import { watchClientById } from "@/services/clients";
import { watchUserDespachos } from "@/services/despachosAccess";

type ClientLite = {
  id: string;
  name?: string;
  rootId?: string | null;
  adminId?: string | null;
  managedByUserId?: string | null;
  active?: boolean;
};

type UserLite = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  nombreusuario?: string | null;
  role?: string | null;
  despachoId?: string | null;
};

type DespachoLite = {
  id: string;
  nombre?: string | null;
};

type OperationTypeCatalogDoc = {
  id: string;
  key: string;
  category?: "OPERACION" | "DISPERSION";
  active?: boolean;
};

type CostDoc = {
  id: string;
  costId?: string;
  operationTypeKey: string;
  operationTypeName: string;
  calculationBaseType: "TOTAL" | "SUBTOTAL";
  pricingMode: "PERCENT" | "FIXED";
  assignedCost: number;
  baseInheritedCost?: number;
  sourceDespachoId?: string | null;
  despachoId?: string | null;
  active?: boolean;
  notes?: string | null;
};

type DespachoCostDoc = {
  id: string;
  operationTypeKey: string;
  operationTypeName: string;
  calculationBaseType: "TOTAL" | "SUBTOTAL";
  pricingMode: "PERCENT" | "FIXED";
  baseCost: number;
  active?: boolean;
  notes?: string | null;
};

type EffectiveRow = {
  costId: string;
  despachoId: string;
  operationTypeKey: string;
  operationTypeName: string;
  calculationBaseType: "TOTAL" | "SUBTOTAL";
  pricingMode: "PERCENT" | "FIXED";
  inheritedCost: number;
  inheritedSource: "user" | "despacho";
};

function normalizeBaseType(value: unknown): "TOTAL" | "SUBTOTAL" {
  return String(value || "").trim().toUpperCase() === "SUBTOTAL" ? "SUBTOTAL" : "TOTAL";
}

function normalizePricingMode(value: unknown): "PERCENT" | "FIXED" {
  const v = String(value || "").trim().toUpperCase();
  const legacyHybridMode = ["MI", "XED"].join("");
  if (v === "FIXED" || v === legacyHybridMode) return "FIXED";
  return "PERCENT";
}

function normalizeCategory(value: unknown): "OPERACION" | "DISPERSION" {
  return String(value || "").trim().toUpperCase() === "DISPERSION" ? "DISPERSION" : "OPERACION";
}

function formatCost(value: number, pricingMode: "PERCENT" | "FIXED") {
  const num = Number(value || 0);
  if (pricingMode === "PERCENT") {
    return `${num.toFixed(4).replace(/\.?0+$/, "")}%`;
  }
  return `$${num.toFixed(2)}`;
}

function sortByName<T extends { operationTypeName?: string; nombre?: string | null }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const aa = String((a as any).operationTypeName || (a as any).nombre || "");
    const bb = String((b as any).operationTypeName || (b as any).nombre || "");
    return aa.localeCompare(bb);
  });
}

export default function ClienteCostosPage() {
  const params = useParams<{ id: string }>();
  const clientId = params.id;
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const { modules, canAccess } = useModuleAccess(profile, "clientes", "costs");

  const meUid = String((user as any)?.uid || "");
  const myRole = normalizeRole((profile as any)?.role);
  const myDespachoId = String((profile as any)?.despachoId || "").trim();
  const isSuper = isSuperAdmin(myRole);
  const isAdminRole = isAdmin(myRole);
  const isOperRole = isOperador(myRole);

  const [clientDoc, setClientDoc] = useState<ClientLite | null>(null);
  const [managerUser, setManagerUser] = useState<UserLite | null>(null);

  const [enabledDespachoIds, setEnabledDespachoIds] = useState<string[]>([]);
  const [allDespachos, setAllDespachos] = useState<DespachoLite[]>([]);
  const [selectedDespachoId, setSelectedDespachoId] = useState("");
  const [activeCategory, setActiveCategory] =
    useState<"OPERACION" | "DISPERSION">("OPERACION");
  const [operationTypes, setOperationTypes] = useState<OperationTypeCatalogDoc[]>([]);

  const [managerCosts, setManagerCosts] = useState<CostDoc[]>([]);
  const [clientCosts, setClientCosts] = useState<CostDoc[]>([]);
  const [despachoCosts, setDespachoCosts] = useState<DespachoCostDoc[]>([]);

  const [selectedOperationTypeKey, setSelectedOperationTypeKey] = useState("");
  const [assignedCost, setAssignedCost] = useState("");
  const [clientCalculationBaseType, setClientCalculationBaseType] = useState<"TOTAL" | "SUBTOTAL">("TOTAL");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!clientId) return;
    return watchClientById(clientId, (data) => {
      setClientDoc(data ? { id: data.id, name: data.name || "", rootId: data.rootId || null, adminId: data.adminId || null, managedByUserId: data.managedByUserId || null, active: data.active !== false } : null);
    });
  }, [clientId]);

  const managerUserId = useMemo(() => {
    if (!clientDoc) return "";
    return String(clientDoc.managedByUserId || clientDoc.adminId || "").trim();
  }, [clientDoc]);

  useEffect(() => {
    if (!managerUserId) {
      setManagerUser(null);
      return;
    }

    return onSnapshot(doc(db, "users", managerUserId), (snap) => {
      if (!snap.exists()) {
        setManagerUser(null);
        return;
      }
      const data = snap.data() as any;
      setManagerUser({
        uid: snap.id,
        email: data?.email || null,
        displayName: data?.displayName || null,
        nombreusuario: data?.nombreusuario || null,
        role: data?.role || null,
        despachoId: data?.despachoId || null,
      });
    });
  }, [managerUserId]);

  const ownerDespachoUid = managerUserId || meUid;

  useEffect(() => {
    if (!ownerDespachoUid) {
      setEnabledDespachoIds([]);
      return;
    }
    return watchUserDespachos(ownerDespachoUid, (ids) => setEnabledDespachoIds(ids || []));
  }, [ownerDespachoUid]);

  useEffect(() => {
    if (!canAccess) {
      setAllDespachos([]);
      return;
    }

    const qd = query(collection(db, "despachos"), orderBy("nombre", "asc"));
    return onSnapshot(qd, (snap) => {
      const rows = snap.docs.map((d) => ({
        id: d.id,
        nombre: (d.data() as any)?.nombre || d.id,
      }));
      setAllDespachos(sortByName(rows));
    });
  }, [canAccess]);

  const availableDespachos = useMemo(() => {
    if (enabledDespachoIds.length > 0) {
      return allDespachos.filter((d) => enabledDespachoIds.includes(d.id));
    }

    if (isSuper) {
      return allDespachos;
    }

    const fallbackIds = new Set(
      [String(managerUser?.despachoId || "").trim(), myDespachoId].filter(Boolean)
    );
    if (fallbackIds.size > 0) {
      return allDespachos.filter((d) => fallbackIds.has(d.id));
    }

    return [];
  }, [enabledDespachoIds, allDespachos, isSuper, managerUser?.despachoId, myDespachoId]);

  useEffect(() => {
    const preferred =
      [
        ...enabledDespachoIds,
        String(managerUser?.despachoId || "").trim(),
        myDespachoId,
        String(availableDespachos[0]?.id || "").trim(),
      ].find(Boolean) || "";

    if (!selectedDespachoId && preferred) {
      setSelectedDespachoId(preferred);
      return;
    }

    if (
      selectedDespachoId &&
      availableDespachos.length > 0 &&
      !availableDespachos.some((x) => x.id === selectedDespachoId)
    ) {
      setSelectedDespachoId(preferred);
    }
  }, [selectedDespachoId, enabledDespachoIds, managerUser?.despachoId, myDespachoId, availableDespachos]);

  useEffect(() => {
    if (!clientId) return;
    return onSnapshot(collection(db, "clients", clientId, "costos"), (snap) => {
      const rows: CostDoc[] = snap.docs.map((d) => {
        const x: any = d.data();
        return {
          id: d.id,
          costId: x?.costId || d.id,
          operationTypeKey: String(x?.operationTypeKey || d.id),
          operationTypeName: String(x?.operationTypeName || d.id),
          calculationBaseType: normalizeBaseType(x?.calculationBaseType),
          pricingMode: normalizePricingMode(x?.pricingMode),
          assignedCost: Number(x?.assignedCost || 0),
          baseInheritedCost: Number(x?.baseInheritedCost || 0),
          sourceDespachoId: x?.sourceDespachoId || null,
          despachoId: x?.despachoId || null,
          active: x?.active !== false,
          notes: x?.notes || null,
        };
      });
      setClientCosts(sortByName(rows));
    });
  }, [clientId]);

  const managerRole = normalizeRole(managerUser?.role || "");
  const useManagerCostsAsSource = !!managerUserId && managerRole !== "superadmin";

  useEffect(() => {
    if (!managerUserId || !useManagerCostsAsSource) {
      setManagerCosts([]);
      return;
    }

    return onSnapshot(collection(db, "users", managerUserId, "costos"), (snap) => {
      const rows: CostDoc[] = snap.docs.map((d) => {
        const x: any = d.data();
        return {
          id: d.id,
          costId: x?.costId || d.id,
          operationTypeKey: String(x?.operationTypeKey || d.id),
          operationTypeName: String(x?.operationTypeName || d.id),
          calculationBaseType: normalizeBaseType(x?.calculationBaseType),
          pricingMode: normalizePricingMode(x?.pricingMode),
          assignedCost: Number(x?.assignedCost || 0),
          baseInheritedCost: Number(x?.baseInheritedCost || 0),
          sourceDespachoId: x?.sourceDespachoId || null,
          despachoId: x?.despachoId || null,
          active: x?.active !== false,
          notes: x?.notes || null,
        };
      });
      setManagerCosts(sortByName(rows));
    });
  }, [managerUserId, useManagerCostsAsSource]);

  useEffect(() => {
    if (!selectedDespachoId) {
      setDespachoCosts([]);
      return;
    }

    const qd = query(
      collection(db, "despachos", selectedDespachoId, "costos"),
      orderBy("operationTypeName")
    );

    return onSnapshot(qd, (snap) => {
      const rows: DespachoCostDoc[] = snap.docs.map((d) => {
        const x: any = d.data();
        return {
          id: d.id,
          operationTypeKey: String(x?.operationTypeKey || d.id),
          operationTypeName: String(x?.operationTypeName || d.id),
          calculationBaseType: normalizeBaseType(x?.calculationBaseType),
          pricingMode: normalizePricingMode(x?.pricingMode),
          baseCost: Number(x?.baseCost || 0),
          active: x?.active !== false,
          notes: x?.notes || null,
        };
      });
      setDespachoCosts(sortByName(rows));
    });
  }, [selectedDespachoId]);

  useEffect(() => {
    const qTypes = query(collection(db, "operationTypes"), orderBy("name"));
    return onSnapshot(qTypes, (snap) => {
      const rows: OperationTypeCatalogDoc[] = snap.docs.map((d) => {
        const x: any = d.data();
        return {
          id: d.id,
          key: String(x?.key || d.id),
          category: normalizeCategory(x?.category),
          active: x?.active !== false,
        };
      });
      setOperationTypes(rows);
    });
  }, []);

  const canManageClient = useMemo(() => {
    if (!canAccess || !clientDoc) return false;
    if (isSuper) return true;
    if (isAdminRole) return String(clientDoc.adminId || "") === meUid;
    if (isOperRole) return String(clientDoc.managedByUserId || "") === meUid;
    return false;
  }, [canAccess, clientDoc, isSuper, isAdminRole, isOperRole, meUid]);

  const visibleOperationTypeKeys = useMemo(() => {
    return new Set(
      operationTypes
        .filter(
          (row) =>
            normalizeCategory(row.category) ===
              activeCategory &&
            row.active !== false,
        )
        .map((row) =>
          String(row.key || "").trim(),
        )
        .filter(Boolean),
    );
  }, [operationTypes, activeCategory]);

  const effectiveRows = useMemo(() => {
    if (!selectedDespachoId) return [];

    if (useManagerCostsAsSource) {
      return sortByName(
        managerCosts
          .filter(
            (row) =>
              String(row.despachoId || row.sourceDespachoId || "").trim() === selectedDespachoId &&
              visibleOperationTypeKeys.has(String(row.operationTypeKey || "").trim())
          )
          .map((row) => ({
            costId: row.costId || `${selectedDespachoId}__${row.operationTypeKey}`,
            despachoId: selectedDespachoId,
            operationTypeKey: row.operationTypeKey,
            operationTypeName: row.operationTypeName,
            calculationBaseType: row.calculationBaseType,
            pricingMode: row.pricingMode,
            inheritedCost: Number(row.assignedCost || 0),
            inheritedSource: "user" as const,
          }))
      );
    }

    return sortByName(
      despachoCosts
        .filter((row) => visibleOperationTypeKeys.has(String(row.operationTypeKey || "").trim()))
        .map((row) => ({
          costId: `${selectedDespachoId}__${row.operationTypeKey}`,
          despachoId: selectedDespachoId,
          operationTypeKey: row.operationTypeKey,
          operationTypeName: row.operationTypeName,
          calculationBaseType: row.calculationBaseType,
          pricingMode: row.pricingMode,
          inheritedCost: Number(row.baseCost || 0),
          inheritedSource: "despacho" as const,
        }))
    );
  }, [selectedDespachoId, useManagerCostsAsSource, managerCosts, despachoCosts, visibleOperationTypeKeys]);

  const selectedCostId = useMemo(() => {
    if (!selectedDespachoId || !selectedOperationTypeKey) return "";
    return `${selectedDespachoId}__${selectedOperationTypeKey}`;
  }, [selectedDespachoId, selectedOperationTypeKey]);

  const selectedEffectiveRow = useMemo(() => {
    return effectiveRows.find((x) => x.costId === selectedCostId) || null;
  }, [effectiveRows, selectedCostId]);

  const selectedAssignedRow = useMemo(() => {
    return clientCosts.find((x) => (x.costId || x.id) === selectedCostId) || null;
  }, [clientCosts, selectedCostId]);

  const clientCostsForSelectedDespacho = useMemo(() => {
    return clientCosts.filter((x) => String(x.despachoId || x.sourceDespachoId || "").trim() === selectedDespachoId);
  }, [clientCosts, selectedDespachoId]);

  useEffect(() => {
    if (!selectedOperationTypeKey && effectiveRows.length > 0) {
      setSelectedOperationTypeKey(effectiveRows[0].operationTypeKey);
      return;
    }

    if (
      selectedOperationTypeKey &&
      effectiveRows.length > 0 &&
      !effectiveRows.some((x) => x.operationTypeKey === selectedOperationTypeKey)
    ) {
      setSelectedOperationTypeKey(effectiveRows[0].operationTypeKey);
      return;
    }

    if (effectiveRows.length === 0) {
      setSelectedOperationTypeKey("");
    }
  }, [effectiveRows, selectedOperationTypeKey]);

  useEffect(() => {
    if (!selectedEffectiveRow) {
      setAssignedCost("");
      setClientCalculationBaseType("TOTAL");
      setNotes("");
      return;
    }

    setAssignedCost(
      selectedAssignedRow
        ? String(selectedAssignedRow.assignedCost)
        : String(selectedEffectiveRow.inheritedCost)
    );
    setClientCalculationBaseType(
      selectedAssignedRow
        ? normalizeBaseType(
            selectedAssignedRow.calculationBaseType,
          )
        : normalizeBaseType(
            selectedEffectiveRow.calculationBaseType,
          ),
    );
    setNotes(selectedAssignedRow?.notes || "");
  }, [selectedEffectiveRow, selectedAssignedRow]);

  const despachoOptions = useMemo<UiSelectOption[]>(
    () => [
      { value: "", label: "Selecciona despacho", disabled: true },
      ...availableDespachos.map((d) => ({
        value: d.id,
        label: d.nombre || d.id,
      })),
    ],
    [availableDespachos]
  );

  const operationTypeOptions = useMemo<UiSelectOption[]>(
    () => [
      { value: "", label: "Selecciona", disabled: true },
      ...effectiveRows.map((row) => ({
        value: row.operationTypeKey,
        label: row.operationTypeName,
      })),
    ],
    [effectiveRows]
  );

  // H4_D82_A2_A3B_CLIENT_COST_CATEGORY_TABS
  useEffect(() => {
    setSelectedOperationTypeKey("");
    setMsg("");
  }, [activeCategory, selectedDespachoId]);

  // H4_D82_A2_A4_CLIENT_COST_EDIT_AND_MARGIN
  function startEditingAssignedCost(
    row: EffectiveRow,
    assigned?: CostDoc,
  ) {
    setMsg("");
    setSelectedOperationTypeKey(
      row.operationTypeKey,
    );
    setAssignedCost(
      String(
        assigned?.assignedCost ??
          row.inheritedCost,
      ),
    );
    setClientCalculationBaseType(
      normalizeBaseType(
        assigned?.calculationBaseType ??
          row.calculationBaseType,
      ),
    );
    setNotes(assigned?.notes || "");

    window.setTimeout(() => {
      document
        .getElementById(
          "client-operation-cost-form",
        )
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 0);
  }

  async function saveCost(e: FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!clientDoc || !selectedEffectiveRow) {
      setMsg(
        `Selecciona despacho y tipo de ${
          activeCategory === "DISPERSION"
            ? "dispersion"
            : "operacion"
        }.`,
      );
      return;
    }

    if (!selectedDespachoId) {
      setMsg("Selecciona el despacho.");
      return;
    }

    const value = Number(assignedCost);
    if (!Number.isFinite(value) || value < 0) {
      setMsg("Costo invalido. Puede ser cero.");
      return;
    }

    if (value < selectedEffectiveRow.inheritedCost) {
      setMsg(`No puede ser menor al costo heredado (${formatCost(selectedEffectiveRow.inheritedCost, selectedEffectiveRow.pricingMode)}).`);
      return;
    }

    setSaving(true);
    try {
      await setClientOperationCost({
        clientId: clientDoc.id,
        despachoId: selectedDespachoId,
        operationTypeKey: selectedEffectiveRow.operationTypeKey,
        assignedCost: value,
        calculationBaseType: clientCalculationBaseType,
        active: true,
        notes: notes.trim() || undefined,
      });
      setMsg(
        selectedAssignedRow
          ? "Costo asignado actualizado correctamente."
          : "Costo asignado guardado correctamente.",
      );
    } catch (e: any) {
      setMsg(`Error guardando: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  if (!canAccess) {
    return <NoAccess as="main" className="p-6 text-slate-400" message="No tienes acceso a Costos de Clientes." />;
  }

  if (!canManageClient) {
    return <NoAccess as="main" className="p-6 text-slate-400" message="No puedes administrar los costos de este cliente." />;
  }

  return (
    <main className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-slate-100 text-2xl font-semibold">Clientes / Costos</div>
          <div className="text-slate-400 text-sm mt-1">
            La asignacion se hace por despacho + tipo de operacion o dispersion.
          </div>
        </div>

        <Link
          href="/clientes"
          className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 text-slate-100 font-semibold"
        >
          Volver a Clientes
        </Link>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="text-slate-400 text-xs uppercase">Cliente</div>
          <div className="text-slate-100 font-semibold mt-2">
            {clientDoc?.name || clientDoc?.id || "-"}
          </div>
          <div className="text-slate-400 text-sm mt-1">{clientDoc?.id || "-"}</div>
        </div>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="text-slate-400 text-xs uppercase">Hereda de</div>
          <div className="text-slate-100 font-semibold mt-2">
            {useManagerCostsAsSource && managerUser
              ? (managerUser.displayName || managerUser.nombreusuario || managerUser.email || "Usuario sin nombre")
              : "Despacho base"}
          </div>
          <div className="text-slate-400 text-sm mt-1">
            {useManagerCostsAsSource && managerUser ? normalizeRole(managerUser.role || "") : "superadmin / despacho"}
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="text-slate-400 text-xs uppercase">Despacho</div>
          <div className="mt-2">
            <UiSelect
              value={selectedDespachoId}
              options={despachoOptions}
              placeholder="Selecciona despacho"
              onChange={setSelectedDespachoId}
            />
          </div>
          <div className="text-slate-500 text-xs mt-2">
            Solo se muestran tipos validos para este despacho.
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="text-slate-400 text-xs uppercase">Accion modular</div>
          <div className="text-slate-100 font-semibold mt-2">clientes.costs</div>
          <div className="text-slate-400 text-sm mt-1">
            {modules?.clientes?.costs ? "Habilitada" : "Deshabilitada"}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() =>
            setActiveCategory("OPERACION")
          }
          className={[
            "rounded-xl px-4 py-2 text-sm font-semibold transition",
            activeCategory === "OPERACION"
              ? "border border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
              : "border border-white/10 bg-white/[0.03] text-slate-300",
          ].join(" ")}
        >
          Operacion
        </button>

        <button
          type="button"
          onClick={() =>
            setActiveCategory("DISPERSION")
          }
          className={[
            "rounded-xl px-4 py-2 text-sm font-semibold transition",
            activeCategory === "DISPERSION"
              ? "border border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
              : "border border-white/10 bg-white/[0.03] text-slate-300",
          ].join(" ")}
        >
          Dispersion
        </button>
      </div>

      <div className="mt-4 grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <form
          id="client-operation-cost-form"
          onSubmit={saveCost}
          className="p-4 rounded-2xl bg-white/5 border border-white/10"
        >
          <div className="text-slate-100 font-semibold">
            {selectedAssignedRow
              ? "Editar costo asignado"
              : "Asignar costo"}
          </div>
          <div className="mt-1 text-xs leading-relaxed text-slate-500">
            Heredado es el costo base. Cliente es el precio final que PAY0 cobra.
          </div>

          <div className="mt-4">
            <label className="block text-slate-300 text-sm mb-1">
              Tipo de {activeCategory === "DISPERSION" ? "dispersion" : "operacion"}
            </label>
            <UiSelect
              value={selectedOperationTypeKey}
              options={operationTypeOptions}
              placeholder="Selecciona"
              onChange={setSelectedOperationTypeKey}
              disabled={!selectedDespachoId}
            />
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="p-3 rounded-xl bg-black/20 border border-white/10">
              <div className="text-slate-400 text-xs uppercase">Costo heredado</div>
              <div className="text-slate-100 font-semibold mt-2">
                {selectedEffectiveRow ? formatCost(selectedEffectiveRow.inheritedCost, selectedEffectiveRow.pricingMode) : "-"}
              </div>
              <div className="text-slate-500 text-xs mt-1">
                {selectedEffectiveRow?.inheritedSource === "user" ? "Usuario superior" : "Despacho base"}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/20 border border-white/10">
              <div className="text-slate-400 text-xs uppercase">Modo</div>
              <div className="text-slate-100 font-semibold mt-2">
                {selectedEffectiveRow?.pricingMode || "-"}
              </div>
              <div className="text-slate-500 text-xs mt-1">
                {selectedEffectiveRow?.calculationBaseType || "-"}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-slate-300 text-sm mb-1">
              Costo final del cliente
            </label>

              <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-3">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Base calculo cliente</div>
                <UiSelect
                  className="mt-2"
                  value={clientCalculationBaseType}
                  onChange={(value) => setClientCalculationBaseType(normalizeBaseType(value))}
                  options={[
                    { value: "TOTAL", label: "TOTAL" },
                    { value: "SUBTOTAL", label: "SUBTOTAL" },
                  ]}
                  placeholder="Base calculo cliente"
                />
                <div className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  Esta base puede ser distinta a la base heredada del despacho o usuario.
                </div>
              </div>
            <input
              value={assignedCost}
              onChange={(e) => setAssignedCost(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-slate-100"
              placeholder="0.00"
              disabled={!selectedEffectiveRow}
            />
            {selectedEffectiveRow && (
              <div className="mt-2 space-y-1 text-xs">
                <div className="text-slate-500">
                  Minimo permitido:{" "}
                  {formatCost(
                    selectedEffectiveRow.inheritedCost,
                    selectedEffectiveRow.pricingMode,
                  )}
                </div>
                <div className="font-semibold text-emerald-300">
                  Margen:{" "}
                  {formatCost(
                    Math.max(
                      0,
                      Number(assignedCost || 0) -
                        selectedEffectiveRow.inheritedCost,
                    ),
                    selectedEffectiveRow.pricingMode,
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4">
            <label className="block text-slate-300 text-sm mb-1">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-slate-100"
            />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving || !selectedEffectiveRow || !selectedDespachoId}
              className="px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-400/30 hover:bg-cyan-500/25 text-cyan-100 font-semibold disabled:opacity-60"
            >
              {saving
                ? "Guardando..."
                : selectedAssignedRow
                  ? "Actualizar costo"
                  : "Guardar costo"}
            </button>

            {msg && <div className="text-slate-200 text-sm">{msg}</div>}
          </div>
        </form>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="text-slate-100 font-semibold">
            Resumen por despacho /{" "}
            {activeCategory === "DISPERSION"
              ? "Dispersion"
              : "Operacion"}
          </div>

          <div className="mt-4 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400">
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 pr-3">
                    {activeCategory === "DISPERSION"
                      ? "Dispersion"
                      : "Operacion"}
                  </th>
                  <th className="text-left py-3 pr-3">Heredado</th>
                  <th className="text-left py-3 pr-3">Cliente</th>
                  <th className="text-left py-3 pr-3">Margen</th>
                  <th className="text-left py-3 pr-3">Fuente base</th>
                  <th className="text-left py-3 pr-3">Modo</th>
                  <th className="text-right py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {effectiveRows.map((row) => {
                  const assigned = clientCostsForSelectedDespacho.find((x) => (x.costId || x.id) === row.costId);

                  return (
                    <tr key={row.costId} className="border-b border-white/5">
                      <td className="py-3 pr-3 font-semibold">{row.operationTypeName}</td>
                      <td className="py-3 pr-3">{formatCost(row.inheritedCost, row.pricingMode)}</td>
                      <td className="py-3 pr-3">
                        {assigned
                          ? formatCost(
                              assigned.assignedCost,
                              row.pricingMode,
                            )
                          : "Sin configurar"}
                      </td>
                      <td className="py-3 pr-3 text-emerald-300">
                        {assigned
                          ? formatCost(
                              Math.max(
                                0,
                                assigned.assignedCost -
                                  row.inheritedCost,
                              ),
                              row.pricingMode,
                            )
                          : "-"}
                      </td>
                      <td className="py-3 pr-3">
                        {row.inheritedSource === "user"
                          ? "Usuario superior"
                          : "Despacho base"}
                      </td>
                      <td className="py-3 pr-3">
                        {row.pricingMode} /{" "}
                        {assigned?.calculationBaseType ||
                          row.calculationBaseType}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            startEditingAssignedCost(
                              row,
                              assigned,
                            )
                          }
                          className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/20"
                        >
                          {assigned
                            ? "Editar"
                            : "Configurar"}
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {effectiveRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-slate-400">
                      No hay tipos habilitados para este despacho en el nivel superior.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
