"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { canAccessRoutePath, getFirstAllowedRoute, getRouteAccessRule } from "@/lib/roles";
import { getMyRestrictionStatus, reportUnauthorizedRouteAttempt } from "@/services/security";
import { createRestrictionSession, hasTrustedRestriction, type RestrictionUiState } from "@/lib/trustedRestrictionUi";

export default function RouteAccessGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { profile, profileUid, loading: profileLoading } = useUserProfile();
  const uid = user?.uid || null;
  const profileReady = !authLoading && !profileLoading && !!uid && profileUid === uid;
  const trustedPresent = hasTrustedRestriction(profile);
  const restrictionKey = profileReady && trustedPresent ? JSON.stringify([uid, (profile as any).trustedRestrictionV1]) : "";
  const [restriction, setRestriction] = useState<{ key: string; state: RestrictionUiState }>({ key: "", state: { phase: "CHECKING" } });
  const restrictionSession = useRef<ReturnType<typeof createRestrictionSession> | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const reportedRef = useRef<Set<string>>(new Set());
  const phase = !restrictionKey ? "CLEAR" : restriction.key === restrictionKey ? restriction.state.phase : "CHECKING";
  const restrictionBlocks = phase !== "CLEAR";
  // Route policy and trusted account restriction are separate checks. No role bypasses the latter.
  const isSuperadmin = String((profile as any)?.role || "").trim().toLowerCase() === "superadmin";
  const routeAllowed = isSuperadmin || canAccessRoutePath(profile, pathname);
  const routeRule = getRouteAccessRule(pathname);
  const isSetupRoute = pathname === "/setup-superadmin";

  useEffect(() => {
    if (!restrictionKey || !uid) return;
    const session = createRestrictionSession({
      query: async () => {
        if (auth.currentUser?.uid !== uid) throw new Error("Sesion no disponible.");
        const result = await getMyRestrictionStatus();
        if (auth.currentUser?.uid !== uid) throw new Error("Sesion no disponible.");
        return result;
      },
      changed: state => setRestriction({ key: restrictionKey, state }),
    });
    restrictionSession.current = session;
    const refresh = () => { void session.refresh(); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      session.dispose();
      if (restrictionSession.current === session) restrictionSession.current = null;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [restrictionKey, uid]);

  async function endSession() {
    if (signingOut) return;
    setSigningOut(true); setSignOutFailed(false);
    try { await signOut(auth); router.replace("/login"); }
    catch { setSignOutFailed(true); }
    finally { setSigningOut(false); }
  }

  useEffect(() => {
    if (!profileReady || !user || restrictionBlocks) return;
    if (profile && isSetupRoute) { router.replace(getFirstAllowedRoute(profile)); return; }
    if (!profile && isSetupRoute) return;
    if (!profile) { router.replace("/setup-superadmin"); return; }
    if (!routeAllowed) {
      const reportKey = `${user.uid}:${pathname}`;
      if (!reportedRef.current.has(reportKey)) {
        reportedRef.current.add(reportKey);
        reportUnauthorizedRouteAttempt({ path: pathname, matchedRuleHref: routeRule?.href || null,
          requiredModule: routeRule?.moduleKey || null, requiredAction: routeRule?.actionKey || null,
          superadminOnly: routeRule?.superadminOnly === true }).catch(() => { /* Diagnostic failure never changes authority. */ });
      }
      router.replace(getFirstAllowedRoute(profile));
    }
  }, [profileReady, user, profile, routeAllowed, router, isSetupRoute, pathname, routeRule?.href,
    routeRule?.moduleKey, routeRule?.actionKey, routeRule?.superadminOnly, restrictionBlocks]);

  if (authLoading || profileLoading || (user && !profileReady)) return <div style={{ padding: 24 }}>Cargando permisos...</div>;
  if (!user) return null;
  if (restrictionBlocks) return (
    <div className="min-h-screen grid place-items-center bg-[#0b1220] p-6 text-slate-100">
      <section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl" aria-busy={phase === "CHECKING"}>
        <h1 className="text-2xl font-bold">{phase === "CHECKING" ? "Validando acceso..." : phase === "ERROR" ? "No pudimos validar tu acceso" : "Acceso temporalmente restringido"}</h1>
        <p className="mt-3 text-sm text-slate-300" role="status">{phase === "CHECKING" ? "Espera mientras consultamos el estado de tu cuenta." : "Comunicate con el administrador de tu organizacion por el canal habitual. Puedes actualizar el estado cuando te indiquen que el acceso fue revisado."}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" disabled={phase === "CHECKING" || signingOut} onClick={() => { void restrictionSession.current?.refresh(); }} className="rounded-xl bg-amber-400 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50">Actualizar estado</button>
          <button type="button" disabled={signingOut} onClick={() => { void endSession(); }} className="rounded-xl border border-slate-600 px-4 py-3 disabled:opacity-50">{signingOut ? "Cerrando sesion..." : "Cerrar sesion"}</button>
        </div>
        {signOutFailed && <p className="mt-3 text-sm text-rose-300" role="alert">No se pudo cerrar la sesion. Intentalo de nuevo.</p>}
      </section>
    </div>
  );
  if (profile && isSetupRoute) return <div style={{ padding: 24 }}>Redirigiendo...</div>;
  if (!profile && isSetupRoute) return <>{children}</>;
  if (!profile || !routeAllowed) return <div style={{ padding: 24 }}>Validando acceso...</div>;
  return <>{children}</>;
}
