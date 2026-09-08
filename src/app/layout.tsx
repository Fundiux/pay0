"use client";

import "src/styles/globals.css";
import { Inter } from "next/font/google";
import { usePathname } from "next/navigation";
import AppShell from "@/components/AppShell";
import { GlobalLoadingProvider } from "@/components/GlobalLoading";
import MaintenanceGate from "@/components/MaintenanceGate";
import RequireAuth from "@/components/RequireAuth";
import RouteAccessGuard from "@/components/RouteAccessGuard";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isMatRoute = pathname === "/mat" || pathname?.startsWith("/mat/");
  const isLoginPage = pathname === "/login" || isMatRoute;

  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.className} bg-[#0b1220] min-h-screen antialiased`}>
        {isLoginPage ? (
          children
        ) : (
          <RequireAuth>
            <MaintenanceGate>
              <RouteAccessGuard>
                <GlobalLoadingProvider>
                  <AppShell>
                    {children}
                  </AppShell>
                </GlobalLoadingProvider>
              </RouteAccessGuard>
            </MaintenanceGate>
          </RequireAuth>
        )}
      </body>
    </html>
  );
}