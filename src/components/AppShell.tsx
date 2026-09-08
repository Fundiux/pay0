"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Settings,
  Users,
  Menu,
  ChevronDown,
  ChevronRight,
  Layers,
  Briefcase,
  LogOut,
  Wallet,
  CreditCard,
  Shield,
  MessageCircle,
} from "lucide-react";

import { useAuth, logout } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { getVisibleSidebarNav } from "@/lib/roles";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const iconMap: Record<string, any> = {
  dashboard: LayoutDashboard,
  reportes: FileText,
  solicitudes: FileText,
  pagos: CreditCard,
  wallet: Wallet,
  catalogos: Layers,
  clientes: Users,
  despachos: Briefcase,
  administracion: Settings,
  usuarios: Users,
  modulos: Shield,
  telegram: MessageCircle,
  whatsapp: MessageCircle,
};

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useUserProfile();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (key: string) => setOpenGroups((p) => ({ ...p, [key]: !p[key] }));

  const isActive = (href?: string) => {
    if (!href) return false;
    const [pathOnly] = href.split("?");
    return pathname === pathOnly || pathname.startsWith(pathOnly + "/");
  };

  const goTo = (href?: string) => {
    if (!href) return;
    router.push(href);
  };

  const optimizedNav = useMemo(() => {
    return getVisibleSidebarNav(profile as any);
  }, [profile]);

  const userLabel = useMemo(() => {
    const p = profile as any;
    const u = user as any;
    return (p?.nombreUsuario || u?.displayName || u?.email || "Usuario").trim();
  }, [profile, user]);
  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen bg-[#0b1220] grid place-items-center text-slate-200">
        Cargando...
      </div>
    );
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  const SidebarContent = (
    <aside className="h-full bg-[#0b1220] text-slate-200 border-r border-white/10 flex flex-col">
      <div
        className={cx(
          "h-20 flex items-center border-b border-white/10",
          sidebarCollapsed ? "justify-center" : "px-4 justify-between"
        )}
      >
        {!sidebarCollapsed && (
          <span className="font-bold text-sky-400 text-xs uppercase tracking-widest truncate mr-2">
            {userLabel}
          </span>
        )}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="h-10 w-10 flex items-center justify-center rounded-xl border border-white/10 hover:bg-white/5 transition-colors"
        >
          <Menu className="h-5 w-5 text-slate-200" />
        </button>
      </div>

      <nav className="flex-1 px-2 py-6 space-y-1 overflow-y-auto font-sans">
        {optimizedNav.map((item) => {
          const Icon = iconMap[item.iconKey] || FileText;
          const hasChildren = !!item.children?.length;
          const active = hasChildren
            ? item.children!.some((c) => isActive(c.href))
            : isActive(item.href);

          const isOpen = openGroups[item.label] ?? active;

          return (
            <div key={item.label} className="w-full">
              <button
                onClick={() =>
                  hasChildren ? toggleGroup(item.label) : goTo(item.href)
                }
                className={cx(
                  "w-full transition-all flex items-center mb-1",
                  sidebarCollapsed ? "h-12 justify-center rounded-xl" : "px-3 py-2.5 rounded-xl gap-3",
                  active
                    ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                    : "text-slate-400 hover:bg-white/5"
                )}
              >
                <Icon className={cx("shrink-0 text-slate-200", sidebarCollapsed ? "h-6 w-6" : "h-5 w-5")} />
                {!sidebarCollapsed && (
                  <>
                    <span className="text-sm font-semibold flex-1 text-left">{item.label}</span>
                    {hasChildren && (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                  </>
                )}
              </button>

              {!sidebarCollapsed && hasChildren && isOpen && (
                <div className="w-full pl-9 mb-2 space-y-1">
                  {item.children!.map((child) => {
                    const ChildIcon = iconMap[child.iconKey] || FileText;

                    return (
                      <button
                        key={child.label}
                        onClick={() => goTo(child.href)}
                        className={cx(
                          "w-full flex items-center gap-3 py-2 rounded-lg text-sm transition-colors",
                          isActive(child.href) ? "text-sky-400 font-bold" : "text-slate-500 hover:text-slate-200"
                        )}
                      >
                        <ChildIcon className="h-4 w-4" />
                        {child.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10">
        <button
          onClick={async () => {
            await logout();
            goTo("/login");
          }}
          className={cx(
            "flex items-center transition-all w-full py-3 rounded-xl gap-3 px-3",
            "text-slate-500 hover:text-red-400 hover:bg-red-500/5"
          )}
        >
          <LogOut size={20} />
          {!sidebarCollapsed && <span className="text-sm font-bold">Cerrar sesion</span>}
        </button>
      </div>
    </aside>
  );

  const MobileBottomNav = (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-[#0b1220]/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] pt-2 shadow-2xl shadow-black/50 backdrop-blur md:hidden">
      <div className="flex gap-2 overflow-x-auto">
        {optimizedNav.map((item) => {
          const Icon = iconMap[item.iconKey] || FileText;
          const targetHref = item.href || item.children?.find((child) => !!child.href)?.href;
          const active = item.children?.length
            ? item.children.some((child) => isActive(child.href))
            : isActive(item.href);

          return (
            <button
              key={item.label}
              type="button"
              onClick={() => goTo(targetHref)}
              disabled={!targetHref}
              className={cx(
                "flex min-w-[74px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[10px] font-semibold transition",
                active
                  ? "bg-sky-500/10 text-sky-300 ring-1 ring-sky-400/20"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                !targetHref && "cursor-not-allowed opacity-40"
              )}
              title={item.label}
              aria-label={item.label}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="max-w-[68px] truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
  return (
    <div className="min-h-screen bg-[#0b1220] flex">
      <div
        className={cx(
          "fixed inset-y-0 left-0 z-50 hidden transition-all duration-300 md:block",
          sidebarCollapsed ? "md:w-20" : "md:w-64"
        )}
      >
        {SidebarContent}
      </div>

      <div
        className={cx(
          "flex-1 min-w-0 transition-all duration-300 min-h-screen flex flex-col pb-20 md:pb-0",
          sidebarCollapsed ? "md:pl-20" : "md:pl-64"
        )}
      >
        <main className="w-full min-w-0 flex-1 overflow-x-hidden bg-[#0b1220] p-4 sm:p-6">{children}</main>
      </div>

      {MobileBottomNav}
    </div>
  );
}
