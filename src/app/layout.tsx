"use client";

import "src/styles/globals.css";
import { Inter } from "next/font/google";
import { usePathname } from "next/navigation";
import AppShell from "@/components/AppShell";
import AssetsShell from "@/components/assets/AssetsShell";
import HugoShell from "@/components/hugo/HugoShell";
import { GlobalLoadingProvider } from "@/components/GlobalLoading";
import MaintenanceGate from "@/components/MaintenanceGate";
import RequireAuth from "@/components/RequireAuth";
import RouteAccessGuard from "@/components/RouteAccessGuard";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMatRoute = pathname === "/mat" || pathname?.startsWith("/mat/");
  // A signature recipient must never need a PAY0 account. The token itself is
  // the narrowly scoped credential, validated by the public callables.
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
  ) : isSystemLauncher ? (
    children
  ) : (
    <AppShell>{children}</AppShell>
  );

  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.className} ${isAssetsRoute ? "bg-[#17191b]" : "bg-[#0b1220]"} min-h-screen antialiased`}>
        {isLoginPage ? (
          children
        ) : (
          <RequireAuth>
            <MaintenanceGate>
              <RouteAccessGuard>
                <GlobalLoadingProvider>
                  {authenticatedContent}
                </GlobalLoadingProvider>
              </RouteAccessGuard>
            </MaintenanceGate>
          </RequireAuth>
        )}
      </body>
    </html>
  );
}
