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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !loadingProfile && user && profile) {
      router.replace(getFirstAllowedRoute(profile));
    }
  }, [user, profile, loading, loadingProfile, router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErr("");
    setSubmitting(true);
    try {
      await loginWithEmailPassword(email.trim().toLowerCase(), password);
    } catch (error: any) {
      setErr(error?.message || "No se pudo iniciar sesión.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#06101c] px-4 py-6 sm:px-8 sm:py-8">
      <div className="absolute inset-0 bg-cover bg-center sm:bg-[center_right]" style={{ backgroundImage: "url('/images/pay0-login-operations-background.png')" }} />
      <div className="absolute inset-0 bg-slate-950/35" />
      <div className="relative mx-auto flex min-h-[calc(100vh-3rem)] max-w-7xl items-center justify-center sm:min-h-[calc(100vh-4rem)]">
        <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl border border-cyan-300/70 bg-slate-950/10 p-6 shadow-2xl shadow-cyan-950/30 backdrop-blur-sm sm:p-9">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-white">Bienvenido</h1>
          </div>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-200">Correo electrónico</label>
              <input value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/15" type="email" autoComplete="email" placeholder="tu@empresa.com" required />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-200">Contraseña</label>
              <input value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/15" type="password" autoComplete="current-password" placeholder="••••••••" required />
            </div>
            {err ? <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{err}</div> : null}
            <button type="submit" disabled={submitting} className="w-full rounded-xl bg-cyan-300 py-3 font-semibold text-slate-950 transition-all hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Validando acceso..." : "Entrar al sistema"}</button>
          </div>
        </form>
      </div>
    </main>
  );
}
