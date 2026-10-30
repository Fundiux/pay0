"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppWindow, Bot, LogOut } from "lucide-react";
import { logout, useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";

export default function HugoShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const label = (profile as any)?.nombreUsuario || user?.displayName || user?.email || "Usuario";
  return <div className="min-h-screen bg-[#080d18] text-slate-100">
    <header className="sticky top-0 z-40 border-b border-violet-500/15 bg-[#080d18]/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-5">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><Bot size={21}/></span>
        <div><p className="font-semibold tracking-[0.18em] text-white">Hugo</p><p className="text-[10px] uppercase tracking-wider text-slate-500">Equipo de agentes PAY0 · {label}</p></div>
        <button onClick={() => router.push("/systems")} className="ml-auto flex items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-300 hover:border-violet-500/40"><AppWindow size={15}/>Cambiar sistema</button>
        <button onClick={async () => { await logout(); router.push("/login"); }} aria-label="Cerrar sesión" className="rounded-xl border border-slate-800 p-2 text-slate-400 hover:text-white"><LogOut size={16}/></button>
      </div>
      <nav aria-label="Menú de Hugo" className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-5 pb-3 text-sm">
        <a href="/hugo#voz" className="shrink-0 rounded-lg px-3 py-2 text-slate-200 hover:bg-violet-500/15">Hablar</a>
        <a href="/hugo#historial" className="shrink-0 rounded-lg px-3 py-2 text-slate-200 hover:bg-violet-500/15">Conversaciones</a>
        <a href="/hugo#actividad" className="shrink-0 rounded-lg px-3 py-2 text-slate-200 hover:bg-violet-500/15">Actividad</a>
        <a href="/hugo/operations" className="shrink-0 rounded-lg px-3 py-2 text-slate-200 hover:bg-violet-500/15">Operaciones</a>
        <a href="/hugo/evaluation" className="shrink-0 rounded-lg px-3 py-2 text-slate-200 hover:bg-violet-500/15">Evaluación</a>
        <a href="/" className="shrink-0 rounded-lg px-3 py-2 text-slate-200 hover:bg-violet-500/15">Volver a PAY0</a>
      </nav>
    </header>
    {children}
  </div>;
}
