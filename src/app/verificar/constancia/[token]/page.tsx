"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";
import { CALLABLES } from "@/lib/callableNames";

type Verification = { valid: boolean; folio?: string; companyName?: string; clientName?: string; cfdi?: string; sha256?: string; active?: boolean };

export default function PublicConstanciaVerificationPage() {
  const params = useParams<{ token: string }>();
  const [result, setResult] = useState<Verification | null>(null);
  useEffect(() => {
    const token = String(params?.token || "");
    if (!token) return;
    httpsCallable<{ token: string }, Verification>(functions, CALLABLES.getPublicConstanciaVerification)({ token })
      .then((response) => setResult(response.data)).catch(() => setResult({ valid: false }));
  }, [params?.token]);
  const valid = result?.valid === true;
  return <main className="min-h-screen bg-slate-950 px-5 py-12 text-slate-100"><section className="mx-auto max-w-xl rounded-2xl border border-cyan-400/25 bg-slate-900 p-7 shadow-2xl">
    <div className="text-xs font-bold tracking-[0.18em] text-cyan-300">PAY0 | VERIFICACION PUBLICA</div>
    <h1 className="mt-3 text-2xl font-bold">{result === null ? "Verificando documento..." : valid ? "Constancia verificada" : "Documento no verificable"}</h1>
    {valid && <dl className="mt-6 space-y-3 text-sm"><div className="flex justify-between gap-5"><dt className="text-slate-400">Folio</dt><dd className="font-semibold">{result.folio}</dd></div><div className="flex justify-between gap-5"><dt className="text-slate-400">Empresa emisora</dt><dd className="text-right font-semibold">{result.companyName}</dd></div><div className="flex justify-between gap-5"><dt className="text-slate-400">Cliente</dt><dd className="text-right">{result.clientName}</dd></div><div className="flex justify-between gap-5"><dt className="text-slate-400">CFDI / UUID</dt><dd className="break-all text-right">{result.cfdi || "No documentado"}</dd></div><div className="border-t border-slate-700 pt-3"><dt className="text-slate-400">Sello SHA-256</dt><dd className="mt-1 break-all font-mono text-[11px] text-slate-300">{result.sha256}</dd></div>{!result.active && <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-amber-200">Esta version fue reemplazada por una constancia posterior.</p>}</dl>}
    {result !== null && !valid && <p className="mt-4 text-sm text-slate-400">El enlace no corresponde a una constancia PAY0 verificable.</p>}
    <p className="mt-7 text-xs text-slate-500">Este enlace valida solo el documento y no da acceso al sistema ni al expediente.</p>
  </section></main>;
}
