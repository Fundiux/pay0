"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, loginWithEmailPassword } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { getFirstAllowedRoute } from "@/lib/roles";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { profile, loading: loadingProfile } = useUserProfile();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (loading || loadingProfile) return;
    if (user && profile) {
      router.replace(getFirstAllowedRoute(profile));
    }
  }, [user, profile, loading, loadingProfile, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");

    try {
      await loginWithEmailPassword(email.trim().toLowerCase(), password);
    } catch (e: any) {
      setErr(e?.message || "No se pudo iniciar sesión.");
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-[#0b1220] px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-3xl border border-white/10 bg-[#161d2b] p-8 shadow-2xl"
      >
        <h1 className="text-white text-2xl font-bold mb-2">Iniciar sesión</h1>
        <p className="text-slate-400 text-sm mb-6">Acceso solo para usuarios autorizados.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-slate-300 text-sm mb-1">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl bg-black/20 border border-white/10 px-4 py-3 text-slate-100 outline-none"
              type="email"
              autoComplete="email"
            />
          </div>

          <div>
            <label className="block text-slate-300 text-sm mb-1">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl bg-black/20 border border-white/10 px-4 py-3 text-slate-100 outline-none"
              type="password"
              autoComplete="current-password"
            />
          </div>

          {err && (
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-rose-200 text-sm">
              {err}
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-xl bg-sky-500 text-black font-bold py-3 hover:bg-sky-400 transition-all"
          >
            Entrar
          </button>
        </div>
      </form>
    </div>
  );
}
