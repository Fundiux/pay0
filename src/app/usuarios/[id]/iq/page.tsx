"use client";

import Link from "next/link";
import {
  useParams,
} from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  doc,
  getDoc,
} from "firebase/firestore";

import {
  db,
} from "@/lib/firebaseClient";
import {
  useUserProfile,
} from "@/lib/useUserProfile";
import {
  normalizeRole,
} from "@/lib/roles";
import {
  IQ_MODULES,
  type IqCredentialProfile,
  type IqModule,
  listIqCredentialProfiles,
  listUserIqAccess,
  removeUserIqAccess,
  updateUserIqAccess,
} from "@/services/iq";

type TargetUser = {
  uid: string;
  username: string;
  email: string;
};

const AUTOMATIC_IQ_MODULES =
  IQ_MODULES.reduce(
    (
      result,
      moduleKey,
    ) => {
      result[moduleKey] = true;
      return result;
    },
    {} as Record<IqModule, boolean>,
  );

function getUserName(
  data: Record<string, unknown>,
  uid: string,
): string {
  return String(
    data.nombreusuario ??
      data.username ??
      data.displayName ??
      data.name ??
      data.email ??
      "Usuario sin nombre",
  ).trim();
}

export default function UserIqAccountPage() {
  const params = useParams();

  const targetUid = useMemo(
    () =>
      String(
        params?.id || "",
      ).trim(),
    [params],
  );

  const {
    profile,
    loading: profileLoading,
  } = useUserProfile();

  const isSuperAdmin =
    normalizeRole(
      (profile as any)?.role,
    ) === "superadmin";

  const [
    targetUser,
    setTargetUser,
  ] = useState<TargetUser | null>(
    null,
  );

  const [
    iqProfiles,
    setIqProfiles,
  ] = useState<
    IqCredentialProfile[]
  >([]);

  const [
    selectedProfileId,
    setSelectedProfileId,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const activeProfiles = useMemo(
    () =>
      iqProfiles.filter(
        (item) =>
          item.active &&
          item.hasPassword,
      ),
    [iqProfiles],
  );

  const selectedIqProfile =
    useMemo(
      () =>
        activeProfiles.find(
          (item) =>
            item.id ===
            selectedProfileId,
        ) || null,
      [
        activeProfiles,
        selectedProfileId,
      ],
    );

  async function loadData() {
    if (
      !targetUid ||
      !isSuperAdmin
    ) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const [
        userSnap,
        profiles,
        accessRows,
      ] = await Promise.all([
        getDoc(
          doc(
            db,
            "users",
            targetUid,
          ),
        ),
        listIqCredentialProfiles(),
        listUserIqAccess(),
      ]);

      if (!userSnap.exists()) {
        throw new Error(
          "Usuario PAY0 no encontrado.",
        );
      }

      const userData =
        userSnap.data() as Record<
          string,
          unknown
        >;

      setTargetUser({
        uid: targetUid,
        username: getUserName(
          userData,
          targetUid,
        ),
        email: String(
          userData.email || "",
        ).trim(),
      });

      setIqProfiles(profiles);

      const currentAccess =
        accessRows.find(
          (row) =>
            row.pay0UserId ===
            targetUid &&
            row.active &&
            row.iqEnabled,
        );

      setSelectedProfileId(
        currentAccess
          ?.iqCredentialProfileId ||
          "",
      );
    } catch (error) {
      const err = error as Error;

      setMessage(
        err.message ||
          "No se pudo cargar la cuenta IQ del usuario.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [
    targetUid,
    isSuperAdmin,
  ]);

  async function saveAssignment() {
    if (!selectedProfileId) {
      setMessage(
        "Selecciona el usuario o cuenta IQ que utilizara este usuario PAY0.",
      );
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await updateUserIqAccess({
        pay0UserId: targetUid,
        iqEnabled: true,
        iqCredentialProfileId:
          selectedProfileId,
        allowedModules:
          AUTOMATIC_IQ_MODULES,
      });

      setMessage(
        "Cuenta IQ asignada. El acceso IQ quedo activo automaticamente.",
      );

      await loadData();
    } catch (error) {
      const err = error as Error;

      setMessage(
        err.message ||
          "No se pudo asignar la cuenta IQ.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeAssignment() {
    setSaving(true);
    setMessage("");

    try {
      await removeUserIqAccess(
        targetUid,
      );

      setSelectedProfileId("");

      setMessage(
        "Cuenta IQ removida del usuario PAY0.",
      );

      await loadData();
    } catch (error) {
      const err = error as Error;

      setMessage(
        err.message ||
          "No se pudo remover la cuenta IQ.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!targetUid) {
    return (
      <main className="p-6">
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100">
          Usuario invalido.
        </div>
      </main>
    );
  }

  if (profileLoading) {
    return (
      <main className="p-6 text-slate-300">
        Cargando permisos...
      </main>
    );
  }

  if (!isSuperAdmin) {
    return (
      <main className="p-6">
        <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100">
          Solo Super Admin puede asignar
          cuentas IQ.
        </div>
      </main>
    );
  }

  return (
    <main className="p-6">
      <div className="mx-auto grid max-w-4xl gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm text-slate-400">
              Usuarios / Cuenta IQ
            </div>

            <h1 className="mt-1 text-2xl font-semibold text-white">
              Cuenta IQ del usuario
            </h1>

            <p className="mt-1 text-sm text-slate-400">
              Selecciona que usuario IQ utilizara
              este usuario PAY0 para crear sus
              operaciones.
            </p>
          </div>

          <Link
            href="/usuarios"
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
          >
            Volver a usuarios
          </Link>
        </header>

        {message ? (
          <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100">
            {message}
          </div>
        ) : null}

        {loading ? (
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-slate-300">
            Cargando usuario y cuentas IQ...
          </section>
        ) : (
          <section className="grid gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="grid gap-1">
              <span className="text-xs uppercase tracking-wide text-slate-500">
                Usuario PAY0
              </span>

              <strong className="text-lg text-white">
                {targetUser?.username ||
                  "Usuario PAY0"}
              </strong>

              {targetUser?.email ? (
                <span className="text-sm text-slate-400">
                  {targetUser.email}
                </span>
              ) : null}
            </div>

            <label className="grid gap-2">
              <span className="text-sm text-slate-200">
                Usuario IQ que utilizara
              </span>

              <select
                value={selectedProfileId}
                onChange={(event) =>
                  setSelectedProfileId(
                    event.target.value,
                  )
                }
                disabled={saving}
                className="h-11 rounded-xl border border-white/10 bg-[#0b1220] px-3 text-sm text-white outline-none"
              >
                <option value="">
                  Selecciona usuario IQ
                </option>

                {activeProfiles.map(
                  (iqProfile) => (
                    <option
                      key={iqProfile.id}
                      value={iqProfile.id}
                    >
                      {iqProfile.alias} -{" "}
                      {iqProfile.username}
                    </option>
                  ),
                )}
              </select>
            </label>

            <div className="rounded-xl border border-white/10 bg-[#0b1220] p-4 text-sm text-slate-300">
              {selectedIqProfile ? (
                <>
                  Las solicitudes de{" "}
                  <strong className="text-white">
                    {targetUser?.username}
                  </strong>{" "}
                  se operaran en IQ con el usuario{" "}
                  <strong className="text-sky-300">
                    {selectedIqProfile.username}
                  </strong>
                  .
                </>
              ) : (
                "Todavia no hay una cuenta IQ asignada."
              )}
            </div>

            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              Al asignar una cuenta IQ, el acceso
              queda activo automaticamente. Las
              acciones permitidas se determinan
              con los modulos PAY0 y los despachos
              habilitados para el usuario.
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={saveAssignment}
                disabled={
                  saving ||
                  !selectedProfileId
                }
                className="rounded-xl border border-sky-400/30 bg-sky-500/20 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-500/25 disabled:opacity-50"
              >
                {saving
                  ? "Guardando..."
                  : "Guardar cuenta IQ"}
              </button>

              <button
                type="button"
                onClick={removeAssignment}
                disabled={
                  saving ||
                  !selectedProfileId
                }
                className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-100 hover:bg-red-500/15 disabled:opacity-50"
              >
                Remover cuenta IQ
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
