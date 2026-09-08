"use client";

import { type ReactNode } from "react";
import { logout } from "@/lib/auth";
import { useMaintenanceMode } from "@/lib/useMaintenanceMode";
import { useUserProfile } from "@/lib/useUserProfile";

function normalizeRole(value: unknown) {
  const role = String(value || "").trim().toLowerCase();
  return role === "operator" ? "operador" : role;
}

export default function MaintenanceGate({ children }: { children: ReactNode }) {
  const { profile, loading: profileLoading } = useUserProfile();
  const { enabled, reason, loading: maintenanceLoading } = useMaintenanceMode();

  const role = normalizeRole((profile as any)?.role || (profile as any)?.supervisorRole);
  const isSuperadmin = role === "superadmin";

  if (profileLoading || maintenanceLoading) {
    return (
      <div className="min-h-screen bg-[#0b1220] grid place-items-center text-slate-200">
        Cargando...
      </div>
    );
  }

  if (!enabled && !isSuperadmin) {
    return (
      <div className="min-h-screen bg-[#0b1220] text-white grid place-items-center px-6">
        <div className="w-full max-w-lg rounded-3xl border border-amber-400/20 bg-white/[0.03] p-8 text-center shadow-2xl shadow-black/40">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300">
            !
          </div>
          <h1 className="text-2xl font-semibold text-white">Sistema en mantenimiento</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {reason || "El acceso esta temporalmente deshabilitado. Intenta mas tarde."}
          </p>
          <button
            onClick={async () => {
              await logout();
              window.location.href = "/login";
            }}
            className="mt-6 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.08]"
          >
            Cerrar sesion
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}