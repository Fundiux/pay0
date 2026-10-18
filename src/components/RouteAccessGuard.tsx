"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { canAccessRoutePath, getFirstAllowedRoute, getRouteAccessRule } from "@/lib/roles";
import { redeemMySecurityUnlockCode, reportUnauthorizedRouteAttempt } from "@/services/security";

export default function RouteAccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useUserProfile();
  // H4_D85_A10_A20_SUPERADMIN_GUARD_BYPASS
  const isSuperadmin =
    String((profile as any)?.role || "")
      .trim()
      .toLowerCase() === "superadmin";
  const reportedRef = useRef<Set<string>>(new Set());
  const [unlockCode, setUnlockCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState("");

  const routeAllowed = isSuperadmin || canAccessRoutePath(profile, pathname);
  const routeRule = getRouteAccessRule(pathname);
  const isSetupRoute = pathname === "/setup-superadmin";
  const securityLock = (profile as any)?.securityLock;
  const isSecurityLocked = !isSuperadmin && securityLock?.active === true;

  async function unlockWithCode(event: React.FormEvent) {
    event.preventDefault();
    if (!unlockCode.trim() || unlocking) return;
    setUnlocking(true);
    setUnlockError("");
    try {
      await redeemMySecurityUnlockCode(unlockCode.trim());
      router.replace(getFirstAllowedRoute(profile));
    } catch (error: any) {
      setUnlockError(String(error?.message || "Codigo incorrecto."));
    } finally {
      setUnlocking(false);
    }
  }

  useEffect(() => {
    if (authLoading || profileLoading || !user || isSecurityLocked) return;

    if (profile && isSetupRoute) {
      router.replace(getFirstAllowedRoute(profile));
      return;
    }

    if (!profile && isSetupRoute) return;

    if (!profile) {
      router.replace("/setup-superadmin");
      return;
    }

    if (!routeAllowed) {
      const reportKey = `${user.uid}:${pathname}`;

      if (!reportedRef.current.has(reportKey)) {
        reportedRef.current.add(reportKey);

        reportUnauthorizedRouteAttempt({
          path: pathname,
          matchedRuleHref: routeRule?.href || null,
          requiredModule: routeRule?.moduleKey || null,
          requiredAction: routeRule?.actionKey || null,
          superadminOnly: routeRule?.superadminOnly === true,
        }).catch((error) => {
          console.error("No se pudo reportar intento de acceso no autorizado:", error);
        });
      }

      router.replace(getFirstAllowedRoute(profile));
    }
  }, [
    authLoading,
    profileLoading,
    user,
    profile,
    routeAllowed,
    router,
    isSetupRoute,
    pathname,
    routeRule?.href,
    routeRule?.moduleKey,
    routeRule?.actionKey,
    routeRule?.superadminOnly,
    isSecurityLocked,
  ]);

  if (authLoading || profileLoading) {
    return <div style={{ padding: 24 }}>Cargando permisos...</div>;
  }

  if (!user) return null;

  if (isSecurityLocked) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0b1220] p-6 text-slate-100">
        <div className="w-full max-w-lg rounded-2xl border border-rose-400/30 bg-rose-950/20 p-8 text-center shadow-2xl">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-300">Acceso bloqueado</div>
          <h1 className="mt-3 text-2xl font-bold">Comunicate con el administrador</h1>
          <p className="mt-3 text-sm text-slate-300">Comunica este folio al superadmin:</p>
          <div className="mt-5 rounded-xl bg-black/30 px-4 py-4 font-mono text-2xl font-bold tracking-widest text-amber-300">
            {String(securityLock?.incidentCode || "SIN-FOLIO")}
          </div>
          <form onSubmit={unlockWithCode} className="mt-6 space-y-3">
            <input
              value={unlockCode}
              onChange={(event) => setUnlockCode(event.target.value.toUpperCase())}
              placeholder="Codigo enviado por superadmin"
              autoComplete="one-time-code"
              className="w-full rounded-xl border border-white/15 bg-black/30 px-4 py-3 text-center font-mono tracking-widest outline-none focus:border-amber-300"
            />
            <button type="submit" disabled={unlocking || !unlockCode.trim()} className="w-full rounded-xl bg-amber-400 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50">
              {unlocking ? "Validando..." : "Desbloquear"}
            </button>
            {unlockError && <div className="text-sm text-rose-300">Codigo incorrecto o ya utilizado.</div>}
          </form>
        </div>
      </div>
    );
  }

  if (profile && isSetupRoute) {
    return <div style={{ padding: 24 }}>Redirigiendo...</div>;
  }

  if (!profile && isSetupRoute) {
    return <>{children}</>;
  }

  if (!profile || !routeAllowed) {
    return <div style={{ padding: 24 }}>Validando acceso...</div>;
  }

  return <>{children}</>;
}
