"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import NoAccess from "@/components/NoAccess";
import UiSelect, { type UiSelectOption } from "@/components/UiSelect";
import { auth, db } from "@/lib/firebaseClient";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";
import { isAdmin, isSuperAdmin, normalizeRole } from "@/lib/roles";
import { setUserOperationCost } from "@/services/rates";
import { watchUserDespachos } from "@/services/despachosAccess";

type Props = {
  params: { id: string };
};

type UserLite = {
  uid: string;
  email: string | null;
  displayName: string | null;
  nombreusuario?: string | null;
  role: string | null;
  rootId: string | null;
  parentUserId: string | null;
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

export default function UsuarioCostosPage({ params }: Props) {
  const targetUid = params.id;
  const { profile } = useUserProfile();
  const { modules, canAccess } = useModuleAccess(profile, "usuarios", "costs");

  const [meUid, setMeUid] = useState("");
  const [targetUser, setTargetUser] = useState<UserLite | null>(null);
  const [parentUser, setParentUser] = useState<UserLite | null>(null);

  const [enabledDespachoIds, setEnabledDespachoIds] = useState<string[]>([]);
  const [allDespachos, setAllDespachos] = useState<DespachoLite[]>([]);
  const [selectedDespachoId, setSelectedDespachoId] = useState("");
  const [operationTypes, setOperationTypes] = useState<OperationTypeCatalogDoc[]>([]);

  const [parentCosts, setParentCosts] = useState<CostDoc[]>([]);
  const [targetCosts, setTargetCosts] = useState<CostDoc[]>([]);
  const [despachoCosts, setDespachoCosts] = useState<DespachoCostDoc[]>([]);

  const [selectedOperationTypeKey, setSelectedOperationTypeKey] = useState("");
  const [assignedCost, setAssignedCost] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const myRole = normalizeRole((profile as any)?.role);
  const myDespachoId = String((profile as any)?.despachoId || "").trim();
  const isSuper = isSuperAdmin(myRole);
  const isAdminRole = isAdmin(myRole);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setMeUid(u?.uid || "");
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!targetUid) return;

    return onSnapshot(doc(db, "users", targetUid), (snap) => {
      if (!snap.exists()) {
        setTargetUser(null);
        return;
      }
      const data = snap.data() as any;
      setTargetUser({
        uid: snap.id,
        email: data?.email || null,
        displayName: data?.displayName || null,
        nombreusuario: data?.nombreusuario || null,
        role: data?.role || null,
        rootId: data?.rootId || null,
        parentUserId: data?.parentUserId || null,
        despachoId: data?.despachoId || null,
      });
    });
  }, [targetUid]);

  const parentUid = useMemo(() => {
    if (!targetUser) return "";
    const directParent = String(targetUser.parentUserId || "").trim();
    if (directParent) return directParent;

    const rootId = String(targetUser.rootId || "").trim();
    if (rootId && rootId !== targetUser.uid) return rootId;

    return "";
  }, [targetUser]);

  useEffect(() => {
    if (!parentUid) {
      setParentUser(null);
      return;
    }

    return onSnapshot(doc(db, "users", parentUid), (snap) => {
      if (!snap.exists()) {
        setParentUser(null);
        return;
      }
      const data = snap.data() as any;
      setParentUser({
        uid: snap.id,
        email: data?.email || null,
        displayName: data?.displayName || null,
        nombreusuario: data?.nombreusuario || null,
        role: data?.role || null,
        rootId: data?.rootId || null,
        parentUserId: data?.parentUserId || null,
        despachoId: data?.despachoId || null,
      });
    });
  }, [parentUid]);

  useEffect(() => {
    if (!targetUid) return;
    return watchUserDespachos(targetUid, (ids) => {
      setEnabledDespachoIds(ids || []);
    });
  }, [targetUid]);

  useEffect(() => {
    if (!canAccess) {
      setAllDespachos([]);
      return;
    }

    if (isSuper) {
      const qd = query(collection(db, "despachos"), orderBy("nombre", "asc"));
      return onSnapshot(qd, (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          nombre: (d.data() as any)?.nombre || d.id,
        }));
        setAllDespachos(sortByName(rows));
      });
    }

    const local: DespachoLite[] = [];
    const seen = new Set<string>();

    [...enabledDespachoIds, targetUser?.despachoId || "", parentUser?.despachoId || "", myDespachoId].forEach((id) => {
      const val = String(id || "").trim();
      if (val && !seen.has(val)) {
        seen.add(val);
        local.push({ id: val, nombre: val });
      }
    });

    setAllDespachos(sortByName(local));
    return () => {};
  }, [canAccess, isSuper, enabledDespachoIds, targetUser?.despachoId, parentUser?.despachoId, myDespachoId]);

  const availableDespachos = useMemo(() => {
    if (isSuper) {
      if (enabledDespachoIds.length > 0) {
        return allDespachos.filter((d) => enabledDespachoIds.includes(d.id));
      }
      return allDespachos;
    }

    if (enabledDespachoIds.length > 0) {
      return allDespachos.filter((d) => enabledDespachoIds.includes(d.id));
    }

    return allDespachos;
  }, [isSuper, enabledDespachoIds, allDespachos]);

  useEffect(() => {
    const preferred = [
      String(targetUser?.despachoId || "").trim(),
      ...enabledDespachoIds,
      String(parentUser?.despachoId || "").trim(),
      String(myDespachoId || "").trim(),
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
  }, [selectedDespachoId, targetUser?.despachoId, parentUser?.despachoId, myDespachoId, enabledDespachoIds, availableDespachos]);

  useEffect(() => {
    if (!targetUid) return;
    return onSnapshot(collection(db, "users", targetUid, "costos"), (snap) => {
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
      setTargetCosts(sortByName(rows));
    });
  }, [targetUid]);

  const parentRole = normalizeRole(parentUser?.role || "");
  const useParentCostsAsSource = !!parentUid && parentRole !== "superadmin";

  useEffect(() => {
    if (!parentUid || !useParentCostsAsSource) {
      setParentCosts([]);
      return;
    }

    return onSnapshot(collection(db, "users", parentUid, "costos"), (snap) => {
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
      setParentCosts(sortByName(rows));
    });
  }, [parentUid, useParentCostsAsSource]);

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

  const canManageTarget = useMemo(() => {
    if (!canAccess || !targetUser) return false;

    const targetRole = normalizeRole(targetUser.role);

    if (isSuper) {
      return targetRole === "admin" || targetRole === "operador";
    }

    if (isAdminRole) {
      return targetRole === "operador" && String(targetUser.parentUserId || "") === meUid;
    }

    return false;
  }, [canAccess, targetUser, isSuper, isAdminRole, meUid]);

  const visibleOperationTypeKeys = useMemo(() => {
    return new Set(
      operationTypes
        .filter((row) => row.active !== false)
        .map((row) => String(row.key || "").trim())
        .filter(Boolean)
    );
  }, [operationTypes]);

  const effectiveRows = useMemo(() => {
    if (!selectedDespachoId) return [];

    if (useParentCostsAsSource) {
      return sortByName(
        parentCosts
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
  }, [selectedDespachoId, useParentCostsAsSource, parentCosts, despachoCosts, visibleOperationTypeKeys]);

  const selectedCostId = useMemo(() => {
    if (!selectedDespachoId || !selectedOperationTypeKey) return "";
    return `${selectedDespachoId}__${selectedOperationTypeKey}`;
  }, [selectedDespachoId, selectedOperationTypeKey]);

  const selectedEffectiveRow = useMemo(() => {
    return effectiveRows.find((x) => x.costId === selectedCostId) || null;
  }, [effectiveRows, selectedCostId]);

  const selectedAssignedRow = useMemo(() => {
    return targetCosts.find((x) => (x.costId || x.id) === selectedCostId) || null;
  }, [targetCosts, selectedCostId]);

  const targetCostsForSelectedDespacho = useMemo(() => {
    return targetCosts.filter((x) => String(x.despachoId || x.sourceDespachoId || "").trim() === selectedDespachoId);
  }, [targetCosts, selectedDespachoId]);

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
      setNotes("");
      return;
    }

    setAssignedCost(
      selectedAssignedRow
        ? String(selectedAssignedRow.assignedCost)
        : String(selectedEffectiveRow.inheritedCost)
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

  async function saveCost(e: FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!targetUser || !selectedEffectiveRow) {
      setMsg("Selecciona despacho y tipo de operacion.");
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
      await setUserOperationCost({
        userId: targetUser.uid,
        despachoId: selectedDespachoId,
        operationTypeKey: selectedEffectiveRow.operationTypeKey,
        assignedCost: value,
        active: true,
        notes: notes.trim() || undefined,
      });
      setMsg("Costo guardado correctamente.");
    } catch (e: any) {
      setMsg(`Error guardando: ${e?.code || ""} ${e?.message || e}`);
    } finally {
      setSaving(false);
    }
  }

  if (!canAccess) {
    return <NoAccess as="main" className="p-6 text-slate-400" message="No tienes acceso a Costos de Usuarios." />;
  }

  if (!canManageTarget) {
    return <NoAccess as="main" className="p-6 text-slate-400" message="No puedes administrar los costos de este usuario." />;
  }

  return (
    <main className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-slate-100 text-2xl font-semibold">Usuarios / Costos</div>
          <div className="text-slate-400 text-sm mt-1">
            La asignacion se hace por despacho + tipo de operacion.
          </div>
        </div>

        <Link
          href="/usuarios"
          className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 text-slate-100 font-semibold"
        >
          Volver a Usuarios
        </Link>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="text-slate-400 text-xs uppercase">Usuario</div>
          <div className="text-slate-100 font-semibold mt-2">
            {targetUser?.displayName || targetUser?.nombreusuario || targetUser?.email || "Usuario sin nombre"}
          </div>
          <div className="text-slate-400 text-sm mt-1">{targetUser?.email || "-"}</div>
        </div>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="text-slate-400 text-xs uppercase">Hereda de</div>
          <div className="text-slate-100 font-semibold mt-2">
            {useParentCostsAsSource && parentUser
              ? (parentUser.displayName || parentUser.nombreusuario || parentUser.email || "Usuario sin nombre")
              : "Despacho base"}
          </div>
          <div className="text-slate-400 text-sm mt-1">
            {useParentCostsAsSource && parentUser ? normalizeRole(parentUser.role || "") : "superadmin / despacho"}
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
          <div className="text-slate-100 font-semibold mt-2">usuarios.costs</div>
          <div className="text-slate-400 text-sm mt-1">
            {modules?.usuarios?.costs ? "Habilitada" : "Deshabilitada"}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <form onSubmit={saveCost} className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="text-slate-100 font-semibold">Asignar costo</div>

          <div className="mt-4">
            <label className="block text-slate-300 text-sm mb-1">Tipo de operacion</label>
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
            <label className="block text-slate-300 text-sm mb-1">Costo asignado</label>
            <input
              value={assignedCost}
              onChange={(e) => setAssignedCost(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-slate-100"
              placeholder="0.00"
              disabled={!selectedEffectiveRow}
            />
            {selectedEffectiveRow && (
              <div className="text-slate-500 text-xs mt-1">
                Minimo permitido: {formatCost(selectedEffectiveRow.inheritedCost, selectedEffectiveRow.pricingMode)}
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
              {saving ? "Guardando..." : "Guardar costo"}
            </button>

            {msg && <div className="text-slate-200 text-sm">{msg}</div>}
          </div>
        </form>

        <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
          <div className="text-slate-100 font-semibold">Resumen por despacho</div>

          <div className="mt-4 overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400">
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 pr-3">Operacion</th>
                  <th className="text-left py-3 pr-3">Heredado</th>
                  <th className="text-left py-3 pr-3">Asignado</th>
                  <th className="text-left py-3 pr-3">Fuente</th>
                  <th className="text-left py-3">Modo</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {effectiveRows.map((row) => {
                  const assigned = targetCostsForSelectedDespacho.find((x) => (x.costId || x.id) === row.costId);

                  return (
                    <tr key={row.costId} className="border-b border-white/5">
                      <td className="py-3 pr-3 font-semibold">{row.operationTypeName}</td>
                      <td className="py-3 pr-3">{formatCost(row.inheritedCost, row.pricingMode)}</td>
                      <td className="py-3 pr-3">
                        {assigned ? formatCost(assigned.assignedCost, row.pricingMode) : "Sin configurar"}
                      </td>
                      <td className="py-3 pr-3">
                        {row.inheritedSource === "user" ? "Usuario superior" : "Despacho base"}
                      </td>
                      <td className="py-3">{row.pricingMode} / {row.calculationBaseType}</td>
                    </tr>
                  );
                })}

                {effectiveRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-6 text-slate-400">
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
