"use client";

import dynamic from "next/dynamic";

function LoadingForm() {
  return <div role="status" className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/70 text-sm text-slate-200 backdrop-blur-sm">Preparando formulario...</div>;
}

const PagosPage = dynamic(() => import("@/app/pagos/page"), { ssr: false, loading: LoadingForm });
const DispersionesPage = dynamic(() => import("@/app/wallet/dispersiones/page"), { ssr: false, loading: LoadingForm });

export function MatOperationForm({ kind, clientId, onClose }: {
  kind: "pago" | "dispersion";
  clientId?: string;
  onClose: () => void;
}) {
  return kind === "pago"
    ? <PagosPage matCreateOnly onMatClose={onClose} />
    : <DispersionesPage matCreateOnly matClientId={clientId} onMatClose={onClose} />;
}
