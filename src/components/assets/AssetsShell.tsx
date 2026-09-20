"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FileStack, LayoutDashboard, LogOut, Menu, Repeat2, TrendingUp } from "lucide-react";
import { logout, useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";

const nav = [
  { href: "/assets", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/assets/positions", label: "Posiciones", icon: TrendingUp },
  { href: "/assets/movements", label: "Movimientos", icon: Repeat2 },
  { href: "/assets/documents", label: "Documentos", icon: FileStack },
];

export default function AssetsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/assets";
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const userLabel = (profile as any)?.nombreUsuario || user?.displayName || user?.email || "Usuario";
  const active = (href: string, exact?: boolean) => exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return <div className="assets-theme md:flex">
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-[var(--assets-border)] bg-[var(--assets-sidebar)] md:flex">
      <div className="shrink-0 border-b border-[var(--assets-border)] px-5 py-5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.24em] text-[var(--assets-accent)]">PAY0 Platform</p>
        <p className="mt-1 text-xl font-semibold tracking-tight">ASSETS</p>
        <p className="mt-0.5 text-[11px] text-[var(--assets-muted)]">Patrimonio e inversiones</p>
      </div>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {nav.map(({ href, label, icon: Icon, exact }) => <Link key={href} href={href} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px] transition ${active(href, exact) ? "border-[var(--assets-accent)]/25 bg-[var(--assets-accent-soft)] text-[var(--assets-text)] [&_svg]:text-[var(--assets-accent)]" : "border-transparent text-[var(--assets-secondary)] hover:bg-white/[0.04] hover:text-white"}`}><Icon size={16}/>{label}</Link>)}
      </nav>
      <div className="shrink-0 border-t border-[var(--assets-border)] p-3">
        <Link href="/systems" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-[var(--assets-secondary)] hover:bg-white/[0.04] hover:text-white"><Menu size={16}/>Cambiar sistema</Link>
        <p className="truncate px-3 pt-3 text-[11px] text-[var(--assets-muted)]">{userLabel}</p>
        <button onClick={async () => { await logout(); router.push("/login"); }} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] text-[var(--assets-muted)] hover:bg-red-400/[0.06] hover:text-[var(--assets-negative)]"><LogOut size={16}/>Cerrar sesión</button>
      </div>
    </aside>
    <div className="min-w-0 flex-1 pb-20 md:pb-0">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-[var(--assets-border)] bg-[var(--assets-sidebar)]/95 px-4 py-3 backdrop-blur md:hidden">
        <div><p className="text-[8px] uppercase tracking-[0.22em] text-[var(--assets-muted)]">PAY0 Platform</p><p className="text-sm font-semibold">ASSETS</p></div>
        <Link href="/systems" className="assets-control px-3 py-2 text-[11px]">Cambiar sistema</Link>
      </header>
      <main className="w-full p-4 sm:p-5 lg:p-6 2xl:p-7">{children}</main>
    </div>
    <nav className="fixed inset-x-0 bottom-0 z-50 flex justify-around border-t border-[var(--assets-border)] bg-[var(--assets-sidebar)]/95 px-1 pb-[calc(env(safe-area-inset-bottom)+.35rem)] pt-1.5 backdrop-blur md:hidden">
      {nav.map(({ href, label, icon: Icon, exact }) => <Link key={href} href={href} className={`flex min-w-16 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[9px] ${active(href, exact) ? "bg-[var(--assets-accent-soft)] text-[var(--assets-accent)]" : "text-[var(--assets-muted)]"}`}><Icon size={17}/>{label}</Link>)}
    </nav>
  </div>;
}
