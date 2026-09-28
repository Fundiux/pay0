"use client";

import { useEffect, useState } from "react";
import { useUserProfile } from "@/lib/useUserProfile";
import { changeMyPassword, reauthenticateCurrentUser } from "@/lib/auth";
import { accountErrorMessage, normalizeAccountUsername } from "@/lib/accountValidation";
import { setMyUsername } from "@/services/loginIdentity";
import UserCommissionDestinations from "@/components/UserCommissionDestinations";

const inputClass = "mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-sky-400";
export default function AccountPage() {
  const { profile } = useUserProfile();
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"access" | "commissions">("access");
  useEffect(() => { setUsername(String(profile?.usernameNormalized || profile?.username || "")); }, [profile?.usernameNormalized, profile?.username]);

  async function submit(action: "username" | "password") {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      if (action === "username") {
        const normalized = normalizeAccountUsername(username);
        await reauthenticateCurrentUser(currentPassword);
        const result = await setMyUsername(normalized);
        setUsername(result.username);
        setMessage("Usuario actualizado. Puedes usarlo para iniciar sesión; tu correo sigue funcionando.");
      } else {
        await changeMyPassword(currentPassword, newPassword, confirmation);
        setMessage("Contraseña actualizada correctamente.");
      }
    } catch (error) { setMessage(accountErrorMessage(error)); }
    finally { setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setBusy(false); }
  }

  return <main className="mx-auto max-w-2xl space-y-5 text-slate-100">
    <header><h1 className="text-2xl font-semibold">Mi cuenta</h1><p className="mt-2 text-sm text-slate-400">Administra tu acceso y tus destinos de comisión.</p></header>
    <nav className="flex gap-2" aria-label="Secciones de mi cuenta"><button type="button" aria-pressed={tab === "access"} onClick={() => setTab("access")} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Acceso y contraseña</button><button type="button" aria-pressed={tab === "commissions"} onClick={() => { setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setTab("commissions"); }} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Tus destinos de comisión</button></nav>
    {tab === "commissions" ? <UserCommissionDestinations /> : <form onSubmit={event => { event.preventDefault(); void submit("password"); }} className="space-y-5 rounded-2xl border border-white/10 bg-[#161d2b] p-5">
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
        <label className="block text-sm">Contraseña actual<input className={inputClass} type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required /></label>
        <section className="space-y-3 border-t border-white/10 pt-5">
          <label className="block text-sm">Usuario<input className={inputClass} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} value={username} onChange={event => setUsername(event.target.value)} /></label>
          <p className="text-xs text-slate-400">De 3 a 32 caracteres: letras sin acentos, números, punto, guion o guion bajo. No distingue mayúsculas de minúsculas.</p>
          <button type="button" onClick={() => void submit("username")} className="rounded-xl border border-sky-400/30 px-4 py-2 text-sm text-sky-200">Guardar usuario</button>
        </section>
        <section className="space-y-3 border-t border-white/10 pt-5">
          <h2 className="font-medium">Cambiar contraseña</h2>
          <label className="block text-sm">Nueva contraseña<input className={inputClass} type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /></label>
          <label className="block text-sm">Confirmar nueva contraseña<input className={inputClass} type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} required /></label>
          <p className="text-xs text-slate-400">Utiliza al menos 8 caracteres y una contraseña que no uses en otros servicios.</p>
          <button type="submit" className="rounded-xl bg-sky-400 px-4 py-2 text-sm font-semibold text-slate-950">{busy ? "Guardando…" : "Cambiar contraseña"}</button>
        </section>
      </fieldset>
      {message && <p role="status" className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">{message}</p>}
    </form>}
  </main>;
}
