"use client";

import { usePathname } from "next/navigation";
import AppShell from "@/components/AppShell";
import AssetsShell from "@/components/assets/AssetsShell";
import HugoShell from "@/components/hugo/HugoShell";
import { GlobalLoadingProvider } from "@/components/GlobalLoading";
import MaintenanceGate from "@/components/MaintenanceGate";
import RequireAuth from "@/components/RequireAuth";
import RouteAccessGuard from "@/components/RouteAccessGuard";

export default function RootClientShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const isMatRoute = pathname === "/mat" || pathname?.startsWith("/mat/");
  const isSignatureRoute = pathname === "/firma" || pathname?.startsWith("/firma/");
  const isPublicVerificationRoute = pathname === "/verificar" || pathname?.startsWith("/verificar/");
  const isLoginPage = pathname === "/login" || isMatRoute || isSignatureRoute || isPublicVerificationRoute;
  const isAssetsRoute = pathname === "/assets" || pathname?.startsWith("/assets/");
  const isHugoRoute = pathname === "/hugo" || pathname?.startsWith("/hugo/");
  const isSystemLauncher = pathname === "/systems";

  const authenticatedContent = isAssetsRoute ? (
    <AssetsShell>{children}</AssetsShell>
  ) : isHugoRoute ? (
    <HugoShell>{children}</HugoShell>
  ) : isSystemLauncher ? children : (
    <AppShell>{children}</AppShell>
  );

  return (
    <div className={`${isAssetsRoute ? "bg-[#17191b]" : "bg-[#0b1220]"} min-h-screen`}>
      {isLoginPage ? children : (
        <RequireAuth>
          <MaintenanceGate>
            <RouteAccessGuard>
              <GlobalLoadingProvider>{authenticatedContent}</GlobalLoadingProvider>
            </RouteAccessGuard>
          </MaintenanceGate>
        </RequireAuth>
      )}
    </div>
  );
}
