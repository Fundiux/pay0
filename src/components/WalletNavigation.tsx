"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Landmark, Send, Users, WalletCards } from "lucide-react";
import { useUserProfile } from "@/lib/useUserProfile";
import { useModuleAccess } from "@/lib/useModuleAccess";

const items = [
  { href: "/wallet/beneficiarios", label: "Beneficiarios", action: "beneficiarios", icon: Users },
  { href: "/wallet/dispersiones", label: "Dispersiones", action: "dispersiones", icon: Send },
  { href: "/wallet/clientes", label: "Saldo clientes", action: "estadoCuentaCliente", icon: WalletCards },
  { href: "/wallet/estado-cuenta-usuario", label: "Saldo usuarios", action: "estadoCuentaUsuario", icon: Landmark },
] as const;

export default function WalletNavigation() {
  const pathname = usePathname();
  const { profile } = useUserProfile();

  return (
    <nav aria-label="Secciones de Wallet" className="sticky bottom-3 z-40 mx-auto mt-5 w-fit max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur safe-area-bottom">
      <div className="flex max-w-full gap-1 overflow-x-auto">
        {items.map((item) => <WalletNavigationItem key={item.href} item={item} pathname={pathname} profile={profile} />)}
      </div>
    </nav>
  );
}

function WalletNavigationItem({ item, pathname, profile }: { item: (typeof items)[number]; pathname: string; profile: any }) {
  const { canAccess } = useModuleAccess(profile, "wallet", item.action);
  if (!canAccess) return null;
  const active = pathname === item.href || (item.href === "/wallet/clientes" && pathname.startsWith("/wallet/clientes/"));
  const Icon = item.icon;
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={`flex min-w-max items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${active ? "bg-sky-500 text-slate-950 shadow-lg shadow-sky-950/40" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>
      <Icon size={15} aria-hidden="true" />
      <span>{item.label}</span>
    </Link>
  );
}
