import type { Metadata } from "next";
import "src/styles/globals.css";
import { Inter } from "next/font/google";
import RootClientShell from "@/components/RootClientShell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "PAY0", template: "%s | PAY0" },
  description: "Plataforma de operaciones financieras PAY0.",
  applicationName: "PAY0",
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    locale: "es_MX",
    siteName: "PAY0",
    title: "PAY0",
    description: "Plataforma de operaciones financieras PAY0.",
  },
  twitter: {
    card: "summary",
    title: "PAY0",
    description: "Plataforma de operaciones financieras PAY0.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen antialiased`}>
        <RootClientShell>{children}</RootClientShell>
      </body>
    </html>
  );
}
