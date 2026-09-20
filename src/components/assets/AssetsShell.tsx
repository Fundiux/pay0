"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FileStack, LayoutDashboard, LogOut, Menu, Repeat2, TrendingUp } from "lucide-react";
import { logout, useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";

const nav = [
  { href: "/assets", label: "Resumen", icon: LayoutDashboard, exact: true },
  { href: "/assets/positions", label: "Posiciones", icon: TrendingUp },
  { href: "/assets/movements", label: "Movimientos", icon: Repeat2 },
  { href: "/assets/documents", label: "Documentos", icon: FileStack },
];

export default function AssetsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/assets";
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const label = (profile as any)?.nombreUsuario || user?.displayName || user?.email || "Usuario";
  const active = (href: string, exact?: boolean) => exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return <div className="min-h-screen bg-[#07110f] text-stone-100 md:flex">
    <aside className="hidden min-h-screen w-64 shrink-0 border-r border-emerald-950 bg-[#091512] md:flex md:flex-col">
      <div className="border-b border-emerald-950 px-6 py-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-amber-300">PAY0 Platform</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-emerald-100">ASSETS</p>
        <p className="mt-1 text-xs text-stone-500">Patrimonio e inversiones</p>
      </div>
      <nav className="flex-1 space-y-2 p-4">
        {nav.map(({ href, label: itemLabel, icon: Icon, exact }) => <Link key={href} href={href} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition ${active(href, exact) ? "bg-emerald-400/10 text-emerald-200 ring-1 ring-emerald-400/20" : "text-stone-400 hover:bg-white/5 hover:text-stone-100"}`}><Icon size={18}/>{itemLabel}</Link>)}
      </nav>
      <div className="border-t border-emerald-950 p-4">
        <Link href="/systems" className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-amber-200 hover:bg-amber-300/5"><Menu size={18}/>Cambiar sistema</Link>
        <p className="truncate px-4 pt-3 text-xs text-stone-500">{label}</p>
        <button onClick={async () => { await logout(); router.push("/login"); }} className="mt-2 flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm text-stone-500 hover:bg-red-500/5 hover:text-red-300"><LogOut size={18}/>Cerrar sesión</button>
      </div>
    </aside>
    <div className="min-w-0 flex-1 pb-24 md:pb-0">
      <header className="flex items-center justify-between border-b border-emerald-950 bg-[#091512]/95 px-5 py-4 md:hidden"><div><p className="text-[9px] uppercase tracking-[0.25em] text-amber-300">PAY0 Platform</p><p className="font-semibold text-emerald-100">ASSETS</p></div><Link href="/systems" className="rounded-lg border border-emerald-800 px-3 py-2 text-xs text-emerald-200">Cambiar sistema</Link></header>
      <main className="mx-auto w-full max-w-7xl p-5 sm:p-8 lg:p-10">{children}</main>
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-50 flex justify-around border-t border-emerald-950 bg-[#091512]/95 px-2 pb-[calc(env(safe-area-inset-bottom)+.4rem)] pt-2 backdrop-blur md:hidden">
      {nav.map(({ href, label: itemLabel, icon: Icon, exact }) => <Link key={href} href={href} className={`flex min-w-16 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] ${active(href, exact) ? "text-emerald-200" : "text-stone-500"}`}><Icon size={19}/>{itemLabel}</Link>)}
    </nav>
  </div>;
}
