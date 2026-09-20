import authorizationPolicy from "../../config/authorization-policy.json";

export type Role = "superadmin" | "admin" | "operador";

export type ModuleActionMap = Record<string, Record<string, boolean>>;

export type SidebarNavChild = {
  label: string;
  href: string;
  iconKey: string;
  moduleKey?: string;
  actionKey?: string;
  superadminOnly?: boolean;
};

export type SidebarNavItem = {
  label: string;
  href?: string;
  iconKey: string;
  moduleKey?: string;
  actionKey?: string;
  superadminOnly?: boolean;
  children?: SidebarNavChild[];
};

export const ROLE_RANK: Record<Role, number> = {
  operador: 1,
  admin: 2,
  superadmin: 3,
};

export function normalizeRole(input: unknown): Role | "" {
  const r = String(input || "").trim().toLowerCase();

  if (r === "superadmin") return "superadmin";
  if (r === "admin") return "admin";
  if (r === "operador" || r === "operator") return "operador";

  return "";
}

export function hasAtLeast(userRole: unknown, required: Role) {
  const normalized = normalizeRole(userRole);
  if (!normalized) return false;
  return ROLE_RANK[normalized] >= ROLE_RANK[required];
}

export function isSuperAdmin(role: unknown) {
  return normalizeRole(role) === "superadmin";
}

export function isAdmin(role: unknown) {
  return normalizeRole(role) === "admin";
}

export function isOperador(role: unknown) {
  return normalizeRole(role) === "operador";
}

export function canManageUsers(role: unknown) {
  const r = normalizeRole(role);
  return r === "superadmin" || r === "admin";
}

export function canManageDespachos(role: unknown) {
  return normalizeRole(role) === "superadmin";
}

export function canViewWalletGlobal(role: unknown) {
  const r = normalizeRole(role);
  return r === "superadmin" || r === "admin";
}

export function getDefaultModulesForRole(role: unknown): ModuleActionMap {
  const r = normalizeRole(role);
  if (!r) return {};
  const defaults = authorizationPolicy.roleDefaults[r] as ModuleActionMap;
  return JSON.parse(JSON.stringify(defaults));
}

export function mergeModules(role: unknown, storedModules: unknown): ModuleActionMap {
  const base = getDefaultModulesForRole(role);
  const merged: ModuleActionMap = JSON.parse(JSON.stringify(base));
  const stored =
    storedModules && typeof storedModules === "object" && !Array.isArray(storedModules)
      ? (storedModules as ModuleActionMap)
      : {};

  Object.keys(stored).forEach((moduleKey) => {
    if (!Object.hasOwn(merged, moduleKey)) return;
    Object.keys(stored[moduleKey] || {}).forEach((actionKey) => {
      if (!Object.hasOwn(merged[moduleKey], actionKey)) return;
      // El permiso individual puede revocar el techo del rol, nunca elevarlo.
      merged[moduleKey][actionKey] =
        merged[moduleKey][actionKey] === true &&
        stored[moduleKey][actionKey] === true;
    });
  });

  return merged;
}

export function canAccessModule(
  profile: any,
  moduleKey: string,
  actionKey: string = "view"
) {
  if (!profile) return false;
  const modules = mergeModules(profile?.role, profile?.modules);
  return !!modules?.[moduleKey]?.[actionKey];
}

function canAccessNavEntry(
  profile: any,
  entry: { moduleKey?: string; actionKey?: string; superadminOnly?: boolean }
) {
  const role = normalizeRole(profile?.role);

  if (entry.superadminOnly) {
    return role === "superadmin";
  }

  if (!entry.moduleKey) {
    return true;
  }

  return canAccessModule(profile, entry.moduleKey, entry.actionKey || "view");
}

export const SIDEBAR_NAV: SidebarNavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    iconKey: "dashboard",
    moduleKey: "dashboard",
    actionKey: "view",
  },
  {
    label: "Reportes",
    href: "/reportes",
    iconKey: "reportes",
    moduleKey: "reportes",
    actionKey: "view",
  },
  {
    label: "Facturación",
    href: "/facturacion",
    iconKey: "facturacion",
    superadminOnly: true,
  },
  { label: "Hugo", href: "/hugo", iconKey: "hugo", superadminOnly: true },
  { label: "Assets", href: "/assets", iconKey: "assets" },
  {
    label: "Materialidad",
    href: "/materialidad",
    iconKey: "reportes",
    moduleKey: "materialidad",
    actionKey: "view",
  },
  {
    label: "Solicitudes",
    href: "/solicitudes",
    iconKey: "solicitudes",
    moduleKey: "solicitudes",
    actionKey: "view",
  },
  {
    label: "Pagos",
    href: "/pagos",
    iconKey: "pagos",
    moduleKey: "pagos",
    actionKey: "view",
  },
  {
    label: "Wallet",
    iconKey: "wallet",
    children: [
      {
        label: "General",
        href: "/wallet",
        iconKey: "wallet",
        moduleKey: "wallet",
        actionKey: "saldos",
      },
      {
        label: "Adelantos",
        href: "/wallet/adelantos",
        iconKey: "wallet",
        moduleKey: "wallet",
        actionKey: "adelantos",
        superadminOnly: true,
      },      {
        label: "Clientes",
        href: "/wallet/clientes",
        iconKey: "wallet",
        moduleKey: "wallet",
        actionKey: "estadoCuentaCliente",
      },
      {
        label: "Dispersiones",
        href: "/wallet/dispersiones",
        iconKey: "wallet",
        moduleKey: "wallet",
        actionKey: "dispersiones",
      },
      {
        label: "Beneficiarios",
        href: "/wallet/beneficiarios",
        iconKey: "wallet",
        moduleKey: "wallet",
        actionKey: "beneficiarios",
      },

      {
        label: "Estado cuenta usuario",
        href: "/wallet/estado-cuenta-usuario",
        iconKey: "wallet",
        moduleKey: "wallet",
        actionKey: "estadoCuentaUsuario",
      },
    ],
  },
  {
    label: "Catalogos",
    iconKey: "catalogos",
    children: [
      {
        label: "Clientes",
        href: "/clientes",
        iconKey: "clientes",
        moduleKey: "clientes",
        actionKey: "view",
      },
      {
        label: "Despachos",
        href: "/despachos",
        iconKey: "despachos",
        superadminOnly: true,
      },
      {
        label: "Tipos de operacion",
        href: "/catalogos/tipos-operacion",
        iconKey: "catalogos",
        superadminOnly: true,
      },
    ],
  },
  {
    label: "Administracion",
    iconKey: "administracion",
    children: [
      {
        label: "Usuarios",
        href: "/usuarios",
        iconKey: "usuarios",
        moduleKey: "usuarios",
        actionKey: "view",
      },
      {
        label: "Modulos",
        href: "/modulos",
        iconKey: "modulos",
        moduleKey: "modulos",
        actionKey: "view",
      },
      {
        label: "Telegram",
        href: "/telegram",
        iconKey: "telegram",
        moduleKey: "telegram",
        actionKey: "view",
      },
      {
        label: "WhatsApp",
        href: "/whatsapp",
        iconKey: "whatsapp",
        superadminOnly: true,
      },
      {
        label: "Activity Log",
        href: "/activity-log",
        iconKey: "actividad",
        moduleKey: "actividad",
        actionKey: "view",
      },
    ],
  },
];

export function getVisibleSidebarNav(profile: any): SidebarNavItem[] {
  return SIDEBAR_NAV
    .map((item) => ({
      ...item,
      children: item.children?.filter((child) => canAccessNavEntry(profile, child)),
    }))
    .filter((item) => {
      const selfVisible = canAccessNavEntry(profile, item);
      const hasVisibleChildren = !!item.children?.length;
      return selfVisible || hasVisibleChildren;
    });
}

type RouteCandidate = {
  href: string;
  moduleKey?: string;
  actionKey?: string;
  superadminOnly?: boolean;
};

function normalizeRoutePath(pathname: string) {
  const rawPath = String(pathname || "/").split("?")[0].split("#")[0] || "/";
  return rawPath.length > 1 ? rawPath.replace(/\/+$/, "") : rawPath;
}

export function isPublicRoutePath(pathname: string): boolean {
  const path = normalizeRoutePath(pathname);
  return (
    path === "/" ||
    path === "/setup-superadmin" ||
    path === "/mensajes" ||
    path === "/login" ||
    path.startsWith("/login/") ||
    path === "/mat" ||
    path.startsWith("/mat/") ||
    path === "/firma" ||
    path.startsWith("/firma/")
  );
}

export function getDefaultRouteCandidates(): RouteCandidate[] {
  return [
    { href: "/dashboard", moduleKey: "dashboard", actionKey: "view" },
    { href: "/reportes", moduleKey: "reportes", actionKey: "view" },
    { href: "/facturacion", superadminOnly: true },
    { href: "/hugo", superadminOnly: true },
    { href: "/assets" },
    { href: "/materialidad", moduleKey: "materialidad", actionKey: "view" },
    { href: "/solicitudes", moduleKey: "solicitudes", actionKey: "view" },
    { href: "/pagos", moduleKey: "pagos", actionKey: "view" },
        { href: "/wallet", moduleKey: "wallet", actionKey: "saldos" },
    { href: "/wallet/dispersiones", moduleKey: "wallet", actionKey: "dispersiones" },
    { href: "/wallet/beneficiarios", moduleKey: "wallet", actionKey: "beneficiarios" },
    { href: "/clientes", moduleKey: "clientes", actionKey: "view" },
    { href: "/despachos", superadminOnly: true },
    { href: "/usuarios", moduleKey: "usuarios", actionKey: "view" },
    { href: "/modulos", moduleKey: "modulos", actionKey: "view" },
    { href: "/telegram", moduleKey: "telegram", actionKey: "view" },
    { href: "/activity-log", moduleKey: "actividad", actionKey: "view" },
  ];
}

export function getRouteAccessRule(pathname: string): RouteCandidate | null {
  const path = normalizeRoutePath(pathname);
  if (isPublicRoutePath(path)) return null;

  if (/^\/usuarios\/[^/]+\/costos$/.test(path)) {
    return { href: "/usuarios/[id]/costos", moduleKey: "usuarios", actionKey: "costs" };
  }

  if (/^\/usuarios\/[^/]+\/iq$/.test(path)) {
    return { href: "/usuarios/[id]/iq", superadminOnly: true };
  }

  if (/^\/clientes\/[^/]+\/costos$/.test(path)) {
    return { href: "/clientes/[id]/costos", moduleKey: "clientes", actionKey: "costs" };
  }

  if (/^\/clientes\/[^/]+$/.test(path)) {
    return { href: "/clientes/[id]", moduleKey: "clientes", actionKey: "view" };
  }

  if (/^\/despachos\/[^/]+\/costos$/.test(path)) {
    return { href: "/despachos/[id]/costos", superadminOnly: true };
  }

  if (/^\/despachos\/[^/]+$/.test(path)) {
    return { href: "/despachos/[id]", superadminOnly: true };
  }

  if (/^\/materialidad\/[^/]+$/.test(path)) {
    return { href: "/materialidad/[id]", moduleKey: "materialidad", actionKey: "view" };
  }

  if (/^\/wallet\/clientes\/[^/]+$/.test(path)) {
    return { href: "/wallet/clientes/[clienteId]", moduleKey: "wallet", actionKey: "estadoCuentaCliente" };
  }

  const routeRules: RouteCandidate[] = [
    { href: "/integraciones/iq/diagnostico/pagos", superadminOnly: true },
    { href: "/integraciones/iq/automatizacion", superadminOnly: true },
  { href: "/integraciones/iq/diagnostico", superadminOnly: true },
    { href: "/integraciones/iq", superadminOnly: true },
    { href: "/whatsapp", superadminOnly: true },
    { href: "/facturacion", superadminOnly: true },
    { href: "/hugo", superadminOnly: true },
    { href: "/assets" },
    { href: "/catalogos/tipos-operacion", superadminOnly: true },
    { href: "/despachos", superadminOnly: true },
    { href: "/wallet/adelantos", moduleKey: "wallet", actionKey: "adelantos", superadminOnly: true },
    { href: "/wallet/dispersiones", moduleKey: "wallet", actionKey: "dispersiones" },
    { href: "/wallet/beneficiarios", moduleKey: "wallet", actionKey: "beneficiarios" },
    { href: "/wallet/clientes", moduleKey: "wallet", actionKey: "estadoCuentaCliente" },
    { href: "/wallet/estado-cuenta-cliente", moduleKey: "wallet", actionKey: "estadoCuentaCliente" },
    { href: "/wallet/estado-cuenta-usuario", moduleKey: "wallet", actionKey: "estadoCuentaUsuario" },
    { href: "/wallet", moduleKey: "wallet", actionKey: "saldos" },
    { href: "/pagos/reproceso", moduleKey: "pagos", actionKey: "conciliate", superadminOnly: true },
    { href: "/pagos", moduleKey: "pagos", actionKey: "view" },
    { href: "/solicitudes", moduleKey: "solicitudes", actionKey: "view" },
    { href: "/clientes", moduleKey: "clientes", actionKey: "view" },
    { href: "/usuarios", moduleKey: "usuarios", actionKey: "view" },
    { href: "/modulos", moduleKey: "modulos", actionKey: "view" },
    { href: "/telegram", moduleKey: "telegram", actionKey: "view" },
    { href: "/activity-log", moduleKey: "actividad", actionKey: "view" },
    { href: "/materialidad", moduleKey: "materialidad", actionKey: "view" },
    { href: "/reportes", moduleKey: "reportes", actionKey: "view" },
    { href: "/dashboard", moduleKey: "dashboard", actionKey: "view" },
  ];

  return routeRules.find((rule) => path === rule.href) || null;
}

export function canAccessRoutePath(profile: any, pathname: string): boolean {
  // H4_D85_A10_A20_SUPERADMIN_ROUTE_BYPASS
  // El superadministrador operativo nunca entra al challenge de rutas.
  if (normalizeRole(profile?.role) === "superadmin") {
    return true;
  }
  if (isPublicRoutePath(pathname)) {
    return true;
  }

  const rule = getRouteAccessRule(pathname);

  if (!rule) {
    // Toda ruta autenticada no registrada falla cerrada.
    return false;
  }

  if (rule.superadminOnly) {
    return normalizeRole(profile?.role) === "superadmin";
  }

  if (!rule.moduleKey) {
    return true;
  }

  return canAccessModule(profile, rule.moduleKey, rule.actionKey || "view");
}
export function getFirstAllowedRoute(profile: any): string {
  const candidates = getDefaultRouteCandidates();

  for (const route of candidates) {
    if (route.superadminOnly) {
      if (normalizeRole(profile?.role) === "superadmin") {
        return route.href;
      }
      continue;
    }

    if (!route.moduleKey) {
      return route.href;
    }

    if (canAccessModule(profile, route.moduleKey, route.actionKey || "view")) {
      return route.href;
    }
  }

  return "/dashboard";
}
