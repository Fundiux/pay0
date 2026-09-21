"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { listCompanies } from "@/services/companies";
import { setUserCompanies, watchDispatchCompanyAccess } from "@/services/access";
import { setUserDespachos, watchUserDespachos } from "@/services/despachosAccess";
import { normalizeRole, isSuperAdmin, isAdmin, getDefaultModulesForRole, mergeModules } from "@/lib/roles";
import { saveUserModules } from "@/services/users";

type Props = {
  meUid: string;
  meRole: string;
  meDespachoId?: string | null;
  targetUid: string;
  onClose: () => void;
};

type DespachoLite = { id: string; nombre?: string };
type CompanyLite = { id: string; nombre: string; despachoId?: string };
type ModulesShape = Record<string, Record<string, boolean>>;

const H4_D82_A3_A6_A0_HUMAN_NAMES = true;

function rawPermissionError(error: any) {
  return String(
    error?.details?.message ??
      error?.message ??
      error ??
      "Ocurrió un error inesperado.",
  )
    .replace(/^FirebaseError:\s*/i, "")
    .replace(/^functions\/[a-z-]+\s*/i, "")
    .trim();
}

export default function UserPermissionsPanel({
  meUid,
  meRole,
  meDespachoId,
  targetUid,
  onClose,
}: Props) {
  const [targetProfile, setTargetProfile] = useState<any | null>(null);

  const [allDespachos, setAllDespachos] = useState<DespachoLite[]>([]);
  const [selectedDespachos, setSelectedDespachos] = useState<Record<string, boolean>>({});

  const [availableCompanies, setAvailableCompanies] = useState<CompanyLite[]>([]);
  const [companyNamesById, setCompanyNamesById] = useState<Record<string, string>>({});
  const [selectedCompanies, setSelectedCompanies] = useState<Record<string, boolean>>({});

  const [selectedModules, setSelectedModules] = useState<ModulesShape>({});
  const [selectedSystems, setSelectedSystems] = useState({ assets: false });

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const isSuper = isSuperAdmin(meRole);
  const isAdminRole = isAdmin(meRole);

  useEffect(() => {
    let alive = true;

    (async () => {
      setTargetProfile(null);

      try {
        const snap = await getDoc(doc(db, "users", targetUid));
        if (!alive) return;

        const data = snap.exists() ? (snap.data() as any) : null;
        setTargetProfile(data);

        setSelectedModules(mergeModules(data?.role, data?.modules));
        setSelectedSystems({ assets: data?.systemAccess?.assets === true });
      } catch (e: any) {
        if (!alive) return;
        setMsg(`No pude leer el usuario: ${e?.code || e?.message || e}`);
      }
    })();

    return () => {
      alive = false;
    };
  }, [targetUid]);

  useEffect(() => {
    if (!meUid) return;

    if (!isSuper) {
      setAllDespachos([]);
      return;
    }

    const qd = query(collection(db, "despachos"), orderBy("nombre", "asc"));
    return onSnapshot(qd, (snap) => {
      setAllDespachos(
        snap.docs.map((d) => ({
          id: d.id,
          nombre: (d.data() as any)?.nombre,
        }))
      );
    });
  }, [meUid, meRole, isSuper]);

  useEffect(() => {
    if (!targetUid) return;

    return watchUserDespachos(targetUid, (ids) => {
      const next: Record<string, boolean> = {};
      ids.forEach((id) => {
        next[id] = true;
      });
      setSelectedDespachos(next);
    });
  }, [targetUid]);

  const selectedDespachoIds = useMemo(() => {
    return Object.entries(selectedDespachos)
      .filter(([, v]) => v)
      .map(([k]) => k);
  }, [selectedDespachos]);

  const targetUserLabel = String(
    targetProfile?.nombre ??
      targetProfile?.displayName ??
      targetProfile?.name ??
      targetProfile?.email ??
      "la persona seleccionada",
  ).trim();

  const selectedDespachoNames = selectedDespachoIds
    .map((id) => allDespachos.find((item) => item.id === id)?.nombre)
    .filter(Boolean) as string[];

  const replaceKnownInternalIds = (value: string) => {
    let text = String(value || "");

    const replacements: Array<[string, string]> = [
      [targetUid, targetUserLabel],
      [meUid, "usuario actual"],
      ...allDespachos
        .filter((item) => item.id && item.nombre)
        .map((item) => [item.id, String(item.nombre)] as [string, string]),
      ...Object.entries(companyNamesById)
        .filter(([id, name]) => id && name)
        .map(([id, name]) => [id, name] as [string, string]),
    ];

    replacements
      .sort((left, right) => right[0].length - left[0].length)
      .forEach(([id, name]) => {
        text = text.split(id).join(`"${name}"`);
      });

    return text
      .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "registro interno")
      .replace(/\s+/g, " ")
      .trim();
  };

  const readablePermissionError = (error: any) =>
    replaceKnownInternalIds(rawPermissionError(error));

  const companyAccessErrorMessage = (
    error: any,
    selectedCompanyIds: string[],
  ) => {
    const raw = rawPermissionError(error);
    const implicatedCompanyId = selectedCompanyIds.find((id) =>
      raw.includes(id),
    );
    const companyName = implicatedCompanyId
      ? companyNamesById[implicatedCompanyId]
      : "";

    if (/Empresa no habilitada en su despacho/i.test(raw)) {
      const companyLabel = companyName
        ? `"${companyName}"`
        : "la empresa seleccionada";
      const dispatchLabel =
        selectedDespachoNames.length === 1
          ? `el despacho "${selectedDespachoNames[0]}"`
          : selectedDespachoNames.length > 1
            ? `los despachos "${selectedDespachoNames.join('", "')}"`
            : "el despacho seleccionado";

      return (
        `No se pudo guardar: ${companyLabel} no está habilitada para ${dispatchLabel}. ` +
        "Primero habilítala en Despachos > Empresas."
      );
    }

    return (
      `No se pudieron guardar las empresas de ${targetUserLabel}: ` +
      readablePermissionError(error)
    );
  };

  const roleCeiling = useMemo(
    () => getDefaultModulesForRole(targetProfile?.role),
    [targetProfile?.role]
  );

  useEffect(() => {
    if (!meUid || !targetUid) return;

    if (isSuper) {
      if (!selectedDespachoIds.length) {
        setAvailableCompanies([]);
        setCompanyNamesById({});
        return;
      }

      let disposed = false;
      let allCompanies: CompanyLite[] = [];
      const enabledByDispatch: Record<string, string[]> = {};

      const publish = () => {
        if (disposed) return;

        const enabledIds = new Set(
          selectedDespachoIds.flatMap(
            (despachoId) => enabledByDispatch[despachoId] || [],
          ),
        );

        setAvailableCompanies(
          allCompanies.filter((company) => enabledIds.has(company.id)),
        );
      };

      const companiesQuery = query(
        collection(db, "companies"),
        orderBy("nombre", "asc"),
      );

      const unsubscribeCompanies = onSnapshot(
        companiesQuery,
        (snapshot) => {
          allCompanies = snapshot.docs.map((companyDoc) => {
            const data: any = companyDoc.data();
            return {
              id: companyDoc.id,
              nombre: String(
                data?.nombre ||
                  data?.razonSocial ||
                  data?.name ||
                  "Empresa sin nombre",
              ),
              despachoId: data?.despachoId,
            };
          });

          setCompanyNamesById(
            Object.fromEntries(
              allCompanies.map((company) => [
                company.id,
                company.nombre,
              ]),
            ),
          );

          publish();
        },
        (error) => {
          setMsg(
            "No se pudieron cargar las empresas: " +
              readablePermissionError(error),
          );
        },
      );

      const unsubscribeAccess = selectedDespachoIds.map(
        (despachoId) =>
          watchDispatchCompanyAccess(
            despachoId,
            (companyIds) => {
              enabledByDispatch[despachoId] = companyIds || [];
              publish();
            },
            (error) => {
              const dispatchName =
                allDespachos.find((item) => item.id === despachoId)
                  ?.nombre || "despacho seleccionado";
              setMsg(
                `No se pudieron leer las empresas habilitadas de "${dispatchName}": ` +
                  readablePermissionError(error),
              );
            },
          ),
      );

      return () => {
        disposed = true;
        unsubscribeCompanies();
        unsubscribeAccess.forEach((unsubscribe) => unsubscribe());
      };
    }

    if (isAdminRole) {
      return listCompanies(
        {
          uid: meUid,
          role: normalizeRole(meRole) || "admin",
          despachoId: meDespachoId || undefined,
        },
        (items: any[]) => {
          const all = items.map((item: any) => ({
            id: item.id,
            nombre: String(
              item.nombre ||
                item.razonSocial ||
                item.name ||
                "Empresa sin nombre",
            ),
            despachoId: item.despachoId,
          }));

          setAvailableCompanies(all);
          setCompanyNamesById(
            Object.fromEntries(
              all.map((company) => [
                company.id,
                company.nombre,
              ]),
            ),
          );
        },
        (error: any) =>
          setMsg(
            "No se pudieron cargar las empresas: " +
              readablePermissionError(error),
          ),
      );
    }

    setAvailableCompanies([]);
    setCompanyNamesById({});
    return () => {};
  }, [
    meUid,
    meRole,
    meDespachoId,
    targetUid,
    selectedDespachoIds.join("|"),
    isSuper,
    isAdminRole,
    allDespachos,
  ]);

  useEffect(() => {
    if (!targetUid) return;

    const ref = collection(db, "userCompanyAccess", targetUid, "companies");
    const qy = query(ref, where("active", "==", true));

    return onSnapshot(qy, (snap) => {
      const next: Record<string, boolean> = {};
      snap.docs.forEach((d) => {
        next[d.id] = true;
      });
      setSelectedCompanies(next);
    });
  }, [targetUid]);

  const toggleDesp = (id: string) => {
    setSelectedDespachos((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleCo = (id: string) => {
    setSelectedCompanies((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleModule = (moduleKey: string, actionKey: string) => {
    setSelectedModules((prev) => ({
      ...prev,
      [moduleKey]: {
        ...(prev[moduleKey] || {}),
        [actionKey]: !prev?.[moduleKey]?.[actionKey],
      },
    }));
  };

  async function save() {
    setMsg("");
    setLoading(true);

    try {
      if (isSuper) {
        try {
          await setUserDespachos(targetUid, selectedDespachoIds, meUid);
        } catch (e: any) {
          setMsg(
            `No se pudieron guardar los despachos de ${targetUserLabel}: ` +
              readablePermissionError(e),
          );
          return;
        }

        try {
          const assignableCompanyIds = new Set(
            availableCompanies.map((company) => company.id),
          );
          const selectedCompanyIds = Object.entries(selectedCompanies)
            .filter(
              ([companyId, selected]) =>
                selected && assignableCompanyIds.has(companyId),
            )
            .map(([companyId]) => companyId);

          await setUserCompanies(targetUid, selectedCompanyIds, meUid);
        } catch (e: any) {
          setMsg(
            companyAccessErrorMessage(
              e,
              Object.entries(selectedCompanies)
                .filter(([, selected]) => selected)
                .map(([companyId]) => companyId),
            ),
          );
          return;
        }

        try {
          await saveUserModules(
            targetUid,
            mergeModules(targetProfile?.role, selectedModules),
            selectedSystems,
          );
        } catch (e: any) {
          setMsg(
            `No se pudieron guardar los módulos de ${targetUserLabel}: ` +
              readablePermissionError(e),
          );
          return;
        }

        setMsg(`Permisos guardados para ${targetUserLabel}.`);
        return;
      }

      if (isAdminRole) {
        try {
          const assignableCompanyIds = new Set(
            availableCompanies.map((company) => company.id),
          );
          const selectedCompanyIds = Object.entries(selectedCompanies)
            .filter(
              ([companyId, selected]) =>
                selected && assignableCompanyIds.has(companyId),
            )
            .map(([companyId]) => companyId);

          await setUserCompanies(targetUid, selectedCompanyIds, meUid);
          await saveUserModules(
            targetUid,
            mergeModules(targetProfile?.role, selectedModules)
          );
          setMsg(`Permisos guardados para ${targetUserLabel}.`);
        } catch (e: any) {
          setMsg(
            `No se pudieron guardar los permisos de ${targetUserLabel}: ` +
              readablePermissionError(e),
          );
        }
        return;
      }

      setMsg("Tu rol no puede asignar permisos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 p-4 rounded-2xl bg-black/20 border border-white/10">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-slate-100 font-semibold">Permisos</div>
        </div>
        <button onClick={onClose} className="text-slate-300 hover:text-white">
          Cerrar
        </button>
      </div>

      {isSuper && (
        <div className="mt-4">
          <div className="text-slate-100 font-semibold">Sistemas</div>
          <p className="mt-1 text-xs text-slate-400">El acceso se valida también en rutas y funciones; no depende solamente del selector visual.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <input type="checkbox" checked disabled />
              <span className="text-slate-100">PAY0 <span className="text-xs text-slate-400">(base)</span></span>
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/5 p-3">
              <input type="checkbox" checked={selectedSystems.assets} onChange={() => setSelectedSystems((current) => ({ assets: !current.assets }))} />
              <span className="text-slate-100">ASSETS</span>
            </label>
          </div>
        </div>
      )}

      {isSuper && (
        <div className="mt-4">
          <div className="text-slate-100 font-semibold">Despachos</div>

          <div className="mt-3 grid gap-2 max-h-[220px] overflow-auto pr-2">
            {allDespachos.map((d) => (
              <label key={d.id} className="flex items-center gap-2 p-2 rounded-xl bg-white/5 border border-white/10">
                <input type="checkbox" checked={!!selectedDespachos[d.id]} onChange={() => toggleDesp(d.id)} />
                <span className="text-slate-100">{d.nombre || "Despacho sin nombre"}</span>
              </label>
            ))}
            {allDespachos.length === 0 && (
              <div className="text-slate-400 text-sm">No hay despachos disponibles.</div>
            )}
          </div>
        </div>
      )}

      <div className="mt-5">
        <div className="text-slate-100 font-semibold">Empresas</div>

        <div className="mt-3 grid gap-2 max-h-[320px] overflow-auto pr-2">
          {availableCompanies.map((c) => (
            <label key={c.id} className="flex items-center gap-2 p-2 rounded-xl bg-white/5 border border-white/10">
              <input type="checkbox" checked={!!selectedCompanies[c.id]} onChange={() => toggleCo(c.id)} />
              <span className="text-slate-100">{c.nombre}</span>
            </label>
          ))}

          {availableCompanies.length === 0 && (
            <div className="text-slate-400 text-sm">
              No hay empresas habilitadas para los despachos seleccionados.
            </div>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="text-slate-100 font-semibold">Módulos</div>

        <div className="mt-3 grid gap-3">
          {Object.entries(selectedModules).map(([moduleKey, actions]) => (
            <div key={moduleKey} className="rounded-xl bg-white/5 border border-white/10 p-3">
              <div className="text-slate-100 font-semibold capitalize mb-3">{moduleKey}</div>

              <div className="flex flex-wrap gap-3">
                {Object.entries(actions).map(([actionKey, enabled]) => (
                  <label
                    key={`${moduleKey}.${actionKey}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/20 border border-white/10"
                  >
                    <input
                      type="checkbox"
                      checked={!!enabled}
                      disabled={roleCeiling?.[moduleKey]?.[actionKey] !== true}
                      onChange={() => toggleModule(moduleKey, actionKey)}
                    />
                    <span className="text-slate-200 text-sm">{actionKey}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={loading}
          className="px-4 py-2 rounded-xl bg-white/10 border border-white/10 hover:bg-white/15 text-slate-100 font-semibold disabled:opacity-60"
        >
          {loading ? "Guardando..." : "Guardar"}
        </button>

        {msg && <div className="text-slate-200 text-sm">{msg}</div>}
      </div>
    </div>
  );
}


