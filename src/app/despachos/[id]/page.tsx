"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { Power, PowerOff } from "lucide-react";
import { createCompanyMutation, toggleCompanyActiveMutation, updateCompanyDepositIdentityMutation } from "@/services/companyMutations";
import { useAuth } from "@/lib/useAuth";
import { useUserProfile } from "@/lib/useUserProfile";

import { setDispatchCompanies, watchDispatchCompanyAccess } from "@/services/access";

type CompanyRow = {
  id: string;
  rootId: string;
  despachoId: string;
  nombre: string;
  rfc: string;
  depositAlias?: string;
  depositClabes?: string[];
  depositAccounts?: Array<{ id: string; clabe: string; status: "ACTIVA" | "INACTIVA"; validFrom?: string | null; validTo?: string | null }>;
  active: boolean;
  createdAt?: any;
};

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

function actionIconClass(kind: "on" | "off") {
  const base = "inline-flex items-center justify-center p-1 text-slate-500 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40";
  const map: Record<string, string> = {
    on: "hover:text-emerald-400",
    off: "hover:text-rose-500",
  };

  return `${base} ${map[kind] || ""}`;
}

export default function DespachoDetallePage({ params }: { params: { id: string } }) {
  const despachoId = params.id;

  const { user } = useAuth();
  const { profile, loading } = useUserProfile();

  const uid = (user as any)?.uid as string | undefined;
  const role = (profile as any)?.role as string | undefined;
  const profileRootId = (profile as any)?.rootId as string | undefined;

  const effectiveRootId = useMemo(() => {
    return profileRootId || uid || "";
  }, [profileRootId, uid]);

  const isSuperadmin = role === "superadmin";

  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const H4_D82_A3_A6_A1_ENABLE_ALL_DISPATCH_COMPANIES = true;
  const [bulkEnabledCompanyIds, setBulkEnabledCompanyIds] =
    useState<string[]>([]);
  const [bulkAccessSaving, setBulkAccessSaving] = useState(false);
  const [bulkAccessMessage, setBulkAccessMessage] = useState("");
  const [open, setOpen] = useState(false);

  const [nombre, setNombre] = useState("");
  const [rfc, setRfc] = useState("");

  const [saving, setSaving] = useState(false);
  const [toggleBusyId, setToggleBusyId] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const [depositEditorCompany, setDepositEditorCompany] = useState<CompanyRow | null>(null);
  const [depositAlias, setDepositAlias] = useState("");
  const [depositClabesText, setDepositClabesText] = useState("");
  const [depositSaving, setDepositSaving] = useState(false);

  useEffect(() => {
    if (!effectiveRootId || !despachoId) return;

    // CLAVE: filtrar tambien por rootId para que la query sea permitida por rules
    const qy = query(
      collection(db, "companies"),
      where("rootId", "==", effectiveRootId),
      where("despachoId", "==", despachoId),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const arr: CompanyRow[] = [];
        snap.forEach((d) => arr.push({ id: d.id, ...(d.data() as any) }));
        setCompanies(arr);
      },
      (e) => {
        console.warn("[companies] snapshot:", (e as any)?.code || (e as any)?.message || e);
      }
    );

    return () => unsub();
  }, [effectiveRootId, despachoId]);


  useEffect(() => {
    if (!despachoId) return;

    return watchDispatchCompanyAccess(
      despachoId,
      (companyIds) => {
        setBulkEnabledCompanyIds(companyIds || []);
      },
      () => {
        setBulkAccessMessage(
          "No se pudo leer el estado de acceso de las empresas.",
        );
      },
    );
  }, [despachoId]);

  const canCreate = useMemo(() => {
    if (loading) return false;
    if (!uid || !effectiveRootId) return false;
    if (!isSuperadmin) return false;
    return nombre.trim().length >= 2 && rfc.trim().length >= 12 && !saving;
  }, [loading, uid, effectiveRootId, isSuperadmin, nombre, rfc, saving]);

  async function onCreate() {
    if (!canCreate) return;

    setSaving(true);
    setErr(null);

    try {
      await createCompanyMutation({
        despachoId,
        nombre: nombre.trim(),
        rfc: rfc.trim().toUpperCase(),
      });

      setOpen(false);
      setNombre("");
      setRfc("");
    } catch (e: any) {
      setErr(e?.message || "No se pudo crear la empresa");
    } finally {
      setSaving(false);
    }
  }

  function openDepositIdentityEditor(company: CompanyRow) {
    setErr(null);
    setDepositEditorCompany(company);
    setDepositAlias(String(company.depositAlias || ""));
    setDepositClabesText(
      Array.isArray(company.depositAccounts) && company.depositAccounts.length
        ? company.depositAccounts.map((row) => `${row.clabe}|${row.status}`).join("\n")
        : Array.isArray(company.depositClabes)
          ? company.depositClabes.map((clabe) => `${clabe}|ACTIVA`).join("\n")
        : "",
    );
  }

  async function saveDepositIdentity() {
    if (!depositEditorCompany || depositSaving) return;

    const alias = depositAlias.trim();
    const accounts = depositClabesText.split(/\r?\n|[,;]/).map((line, index) => {
      const [rawClabe, rawStatus] = line.trim().split("|");
      const clabe = String(rawClabe || "").replace(/\D/g, "");
      const status = String(rawStatus || "ACTIVA").trim().toUpperCase() === "INACTIVA" ? "INACTIVA" as const : "ACTIVA" as const;
      return { id: `deposit_${clabe}_${index}`, clabe, status };
    }).filter((row) => row.clabe);
    const clabes = [...new Set(accounts.map((row) => row.clabe))];

    const invalid = clabes.find((value) => value.length !== 18);
    if (invalid) {
      setErr("Cada CLABE debe tener exactamente 18 digitos.");
      return;
    }

    setDepositSaving(true);
    setErr(null);

    try {
      await updateCompanyDepositIdentityMutation({
        companyId: depositEditorCompany.id,
        depositAlias: alias,
        depositClabes: clabes,
        depositAccounts: accounts,
      });

      setDepositEditorCompany(null);
      setDepositAlias("");
      setDepositClabesText("");
    } catch (e: any) {
      setErr(e?.message || "No se pudo guardar la identificacion de deposito.");
    } finally {
      setDepositSaving(false);
    }
  }

  async function onToggleActive(id: string, nextActive: boolean) {
    if (toggleBusyId === id) return;

    setToggleBusyId(id);
    try {
      await toggleCompanyActiveMutation({
        companyId: id,
        nextActive,
      });
    } catch (e: any) {
      setErr(e?.message || "No se pudo actualizar empresa.");
    } finally {
      setToggleBusyId("");
    }
  }


  const activeDispatchCompanies = companies.filter(
    (company) => company.active !== false,
  );

  const allActiveDispatchCompaniesEnabled =
    activeDispatchCompanies.length > 0 &&
    activeDispatchCompanies.every((company) =>
      bulkEnabledCompanyIds.includes(company.id),
    );

  async function onEnableAllDispatchCompanies() {
    const companyIds = activeDispatchCompanies.map(
      (company) => company.id,
    );

    if (!companyIds.length) {
      setBulkAccessMessage(
        "Este despacho no tiene empresas activas para habilitar.",
      );
      return;
    }

    setBulkAccessSaving(true);
    setBulkAccessMessage("");

    try {
      await setDispatchCompanies(
        despachoId,
        companyIds,
        uid || "",
      );

      setBulkAccessMessage(
        `Acceso habilitado para ${companyIds.length} empresa${companyIds.length === 1 ? "" : "s"}.`,
      );
    } catch {
      setBulkAccessMessage(
        "No se pudo habilitar el acceso. Revisa que las empresas pertenezcan a este despacho.",
      );
    } finally {
      setBulkAccessSaving(false);
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-slate-100 text-xl font-semibold">Empresas</div>
       </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEnableAllDispatchCompanies}
            disabled={
              bulkAccessSaving ||
              activeDispatchCompanies.length === 0 ||
              allActiveDispatchCompaniesEnabled
            }
            className="rounded-2xl px-4 py-2.5 font-semibold border border-emerald-400/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bulkAccessSaving
              ? "Habilitando..."
              : allActiveDispatchCompaniesEnabled
                ? "Todas habilitadas"
                : "Habilitar todas"}
          </button>
        <button
          onClick={() => setOpen(true)}
          className="rounded-2xl px-4 py-2.5 font-semibold border bg-sky-500/20 border-sky-400/30 text-sky-100 hover:bg-sky-500/25"
        >
          Nueva empresa
        </button>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
        <div>
          Acceso para usuarios:{" "}
          <span className="font-semibold text-slate-100">
            {bulkEnabledCompanyIds.filter((companyId) =>
              activeDispatchCompanies.some(
                (company) => company.id === companyId,
              ),
            ).length}
          </span>
          {" "}de{" "}
          <span className="font-semibold text-slate-100">
            {activeDispatchCompanies.length}
          </span>
          {" "}empresas habilitadas.
        </div>

        {bulkAccessMessage ? (
          <div className="text-sky-200">
            {bulkAccessMessage}
          </div>
        ) : null}
      </div>

      <div className="mt-6 rounded-2xl border border-white/10 overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-4 py-3 bg-white/5 text-xs text-slate-400">
          <div className="col-span-6">Empresa</div>
          <div className="col-span-4">RFC</div>
          <div className="col-span-2 text-right">Acceso</div>
        </div>

        {companies.length === 0 ? (
          <div className="px-4 py-4 text-slate-400">Sin empresas</div>
        ) : (
          companies.map((it) => {
            const isActive = it.active !== false;
            return (
              <div key={it.id} className="grid grid-cols-12 gap-2 px-4 py-3 border-t border-white/10">
                <div className="col-span-6 text-slate-100">
                  <div>
                    {it.nombre}{" "}
                    {!isActive && <span className="text-xs text-slate-500">(inactiva)</span>}
                  </div>
                  {(it.depositAlias || (it.depositClabes?.length || 0) > 0) && (
                    <div className="mt-1 text-[10px] text-slate-500">
                      Alias: {it.depositAlias || "---"} · CLABEs: {it.depositClabes?.length || 0}
                    </div>
                  )}
                </div>
                <div className="col-span-4 text-slate-300">{it.rfc}</div>
                <div className="col-span-2 flex items-center justify-end gap-2 text-right">
                  <button
                    type="button"
                    onClick={() => openDepositIdentityEditor(it)}
                    className="rounded-lg border border-sky-400/20 px-2 py-1 text-[10px] text-sky-300 hover:bg-sky-500/10"
                    title="Alias y CLABEs para deteccion de depositos"
                  >
                    Depositos
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleActive(it.id, !isActive)}
                    disabled={toggleBusyId === it.id}
                    className={actionIconClass(isActive ? "off" : "on")}
                    title={isActive ? "Desactivar" : "Activar"}
                    aria-label={isActive ? "Desactivar" : "Activar"}
                  >
                    {isActive ? <PowerOff size={16} /> : <Power size={16} />}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {depositEditorCompany && (
        <div className="fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => !depositSaving && setDepositEditorCompany(null)}
          />
          <div className="absolute inset-0 grid place-items-center p-4">
            <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#0b1220] shadow-2xl">
              <div className="border-b border-white/10 px-5 py-4">
                <div className="text-slate-100 font-semibold">
                  Identificacion de depositos
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {depositEditorCompany.nombre}
                </div>
              </div>

              <div className="space-y-4 p-5">
                <div>
                  <div className="mb-1 text-xs text-slate-400">
                    Alias de deposito
                  </div>
                  <input
                    value={depositAlias}
                    onChange={(e) => setDepositAlias(e.target.value)}
                    placeholder="Ej. AIMIERA"
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-slate-100 outline-none"
                  />
                  <div className="mt-1 text-[10px] text-slate-500">
                    Solo para identificar depositos. No sustituye la razon social.
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-xs text-slate-400">
                    CLABEs de deposito
                  </div>
                  <textarea
                    value={depositClabesText}
                    onChange={(e) => setDepositClabesText(e.target.value)}
                    placeholder={"Una CLABE de 18 digitos por linea\nPuedes agregar varias"}
                    rows={5}
                    className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-slate-100 outline-none"
                  />
                  <div className="mt-1 text-[10px] text-slate-500">
                    Una cuenta por linea: CLABE|ACTIVA o CLABE|INACTIVA. Las cuentas inactivas se conservan para historial.
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 border-t border-white/10 px-5 py-4">
                <button
                  type="button"
                  disabled={depositSaving}
                  onClick={() => setDepositEditorCompany(null)}
                  className="rounded-xl px-4 py-2 text-xs text-slate-400 hover:text-white disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={depositSaving}
                  onClick={saveDepositIdentity}
                  className="rounded-xl border border-sky-400/30 bg-sky-500/20 px-5 py-2 text-xs text-sky-100 hover:bg-sky-500/30 disabled:opacity-50"
                >
                  {depositSaving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => !saving && setOpen(false)} />
          <div className="absolute inset-0 grid place-items-center p-4">
            <div className="w-full max-w-xl rounded-3xl bg-[#0b1220] border border-white/10 shadow-2xl">
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                <div className="text-slate-100 font-semibold">Nueva empresa</div>
                <button
                  onClick={() => !saving && setOpen(false)}
                  className="h-9 w-9 rounded-2xl border border-white/10 hover:bg-white/5 text-slate-200"
                >
                  X  
                </button>
              </div>

              <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="md:col-span-2">
                  <div className="text-xs text-slate-400 mb-1">Nombre *</div>
                  <input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-slate-100 outline-none"
                    placeholder="EMPRESA S.A. DE C.V."
                  />
                </div>

                <div className="md:col-span-2">
                  <div className="text-xs text-slate-400 mb-1">RFC *</div>
                  <input
                    value={rfc}
                    onChange={(e) => setRfc(e.target.value)}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-slate-100 outline-none"
                    placeholder="AAA010101AAA"
                  />
                </div>

                {err && (
                  <div className="md:col-span-2 text-sm text-rose-200 bg-rose-500/10 border border-rose-400/20 rounded-2xl px-4 py-2">
                    {err}
                  </div>
                )}
              </div>

              <div className="px-5 py-4 border-t border-white/10 flex items-center justify-end gap-2">
                <button
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="rounded-2xl px-4 py-2.5 font-semibold border border-white/10 text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={onCreate}
                  disabled={!canCreate}
                  className={cx(
                    "rounded-2xl px-4 py-2.5 font-semibold border",
                    canCreate
                      ? "bg-sky-500/20 border-sky-400/30 text-sky-100 hover:bg-sky-500/25"
                      : "bg-white/5 border-white/10 text-slate-500 cursor-not-allowed"
                  )}
                >
                  {saving ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
