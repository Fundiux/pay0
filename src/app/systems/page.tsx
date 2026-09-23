"use client";

import { ArrowRight, Bot, Landmark, WalletCards } from "lucide-react";
import { useRouter } from "next/navigation";
import { useUserProfile } from "@/lib/useUserProfile";
import { canAccessSystem, getFirstAllowedRoute } from "@/lib/roles";

export default function SystemsPage() {
  const router = useRouter();
  const { profile, loading } = useUserProfile();
  if (loading) return <main className="grid min-h-screen place-items-center bg-[#070d18] text-slate-400">Cargando plataforma…</main>;
  const assetsAllowed = canAccessSystem(profile, "assets");
  const hugoAllowed = profile?.role === "superadmin";
  const cards = [
    { name: "PAY0", description: "Operación, pagos, solicitudes, facturación y control.", icon: WalletCards, action: () => router.push(getFirstAllowedRoute(profile)), enabled: true, style: "border-sky-500/30 bg-sky-500/5 text-sky-200" },
    { name: "ASSETS", description: "Patrimonio, inversiones, préstamos y movimientos.", icon: Landmark, action: () => router.push("/assets"), enabled: assetsAllowed, style: "border-orange-500/35 bg-[#202224] text-orange-300" },
    { name: "HUGO", description: "Atención, tareas, consumo y conversación transversal.", icon: Bot, action: () => router.push("/hugo"), enabled: hugoAllowed, style: "border-violet-500/35 bg-violet-500/5 text-violet-200" },
  ];
  return <main className="min-h-screen bg-[#070d18] px-5 py-16 text-white">
    <section className="mx-auto max-w-5xl">
      <p className="text-xs font-semibold uppercase tracking-[.3em] text-slate-500">PAY0 Platform</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Elige un sistema</h1>
      <p className="mt-3 text-slate-400">Una cuenta y una sesión. Cada sistema conserva su propio contexto, navegación y permisos.</p>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ name, description, icon: Icon, action, enabled, style }) => <button key={name} disabled={!enabled} onClick={action} className={`group min-h-56 rounded-3xl border p-7 text-left transition ${style} ${enabled ? "hover:-translate-y-1 hover:shadow-2xl" : "cursor-not-allowed opacity-40"}`}><Icon size={30}/><h2 className="mt-8 text-2xl font-semibold">{name}</h2><p className="mt-2 text-sm text-slate-400">{enabled ? description : "Sin acceso asignado."}</p>{enabled && <ArrowRight className="mt-7 transition group-hover:translate-x-1" size={20}/>}</button>)}
        <div className="min-h-56 rounded-3xl border border-slate-800 bg-slate-900/40 p-7 text-slate-600"><div className="text-xs font-semibold uppercase tracking-widest">Próximamente</div><h2 className="mt-14 text-2xl font-semibold">TTT</h2><p className="mt-2 text-sm">Sistema preparado para una incorporación futura.</p></div>
      </div>
    </section>
  </main>;
}
