"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebaseClient";

export default function SetupSuperadminPage() {
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setEmail(user?.email || "");
    });

    return () => unsub();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <section className="mx-auto mt-16 max-w-xl rounded-2xl border border-white/10 bg-white/[0.04] p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
          Acceso pendiente
        </div>

        <h1 className="mt-3 text-2xl font-semibold">
          La cuenta no tiene un perfil PAY0 autorizado
        </h1>

        <p className="mt-3 text-sm leading-6 text-slate-300">
          El alta de usuarios y la asignacion de roles se realizan desde la
          administracion autorizada. Esta pantalla no puede crear ni elevar
          privilegios.
        </p>

        {email ? (
          <p className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-300">
            Cuenta autenticada: <span className="font-semibold text-slate-100">{email}</span>
          </p>
        ) : null}
      </section>
    </main>
  );
}