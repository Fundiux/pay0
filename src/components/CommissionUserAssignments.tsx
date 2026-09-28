"use client";
import { useEffect, useState } from "react";
import { useUserProfile } from "@/lib/useUserProfile";
import { useAuth } from "@/lib/auth";
import { listUsers } from "@/services/users";
import { configureUserCommissionEntitlement, getCommissionAutomationConfig, getMyCommissionSettings, runDailyUserCommissionPreflight, saveCommissionAutomationConfig, type CommissionAutomationConfig, type UserCommissionSettings } from "@/services/commissions";
import type { ClientBeneficiaryMethodRow } from "@/services/beneficiaries";
const style = "rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm";

export default function CommissionUserAssignments({ clientId, methods, referencePaymentId }: { clientId: string; methods: ClientBeneficiaryMethodRow[]; referencePaymentId: string }) {
  const { profile } = useUserProfile();
  const { user: authUser } = useAuth();
  const [users, setUsers] = useState<Array<{ uid: string; label: string }>>([]), [ownerUid, setOwnerUid] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [active, setActive] = useState(false), [settings, setSettings] = useState<UserCommissionSettings | null>(null);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [loadingOwner, setLoadingOwner] = useState(false);
  const [automation, setAutomation] = useState<CommissionAutomationConfig | null>(null);
  const superadmin = String(profile?.role || "").toLowerCase() === "superadmin";
  useEffect(() => {
    if (!superadmin) return;
    let live = true;
    (async () => { const rows: Array<{ uid: string; label: string }> = []; let cursor: string | undefined; do { const page = await listUsers({ limit: 200, ...(cursor ? { cursor } : {}) }); rows.push(...(page.users || []).filter((row: any) => !row.isDeleted && row.isActive !== false).map((row: any) => ({ uid: row.uid, label: row.displayName || row.username || "Usuario sin nombre" }))); cursor = page.hasMore ? page.nextCursor : undefined; } while (cursor); if (authUser?.uid && !rows.some(row => row.uid === authUser.uid)) rows.unshift({ uid: authUser.uid, label: String(profile?.displayName || profile?.username || "Mi usuario") }); if (live) setUsers(rows); })().catch(error => { if (live) setMessage(error.message); });
    getCommissionAutomationConfig().then(result => { if (live) setAutomation(result.config); }).catch(error => { if (live) setMessage(error.message); });
    return () => { live = false; };
  }, [superadmin, authUser?.uid, profile?.displayName, profile?.username]);
  useEffect(() => {
    setSettings(null); setSelected([]); setActive(false);
    if (!ownerUid) return;
    let live = true; setLoadingOwner(true);
    getMyCommissionSettings(ownerUid).then(result => { if (live) { setSettings(result); const current = result.configurations.find(row => row.clientId === clientId); setSelected(current?.instruments.map(row => row.methodId) || []); setActive(current?.active || false); } }).catch(error => { if (live) setMessage(error.message); }).finally(() => { if (live) setLoadingOwner(false); });
    return () => { live = false; };
  }, [ownerUid, clientId]);
  if (!superadmin) return null;
  const current = settings?.configurations.find(row => row.clientId === clientId);
  async function saveAssignment() {
    if (busy || loadingOwner || !settings) return;
    setBusy(true); setMessage("");
    try { const saved = await configureUserCommissionEntitlement({ clientId, ownerUid, referencePaymentId: referencePaymentId.trim(), methodIds: selected, active, expectedVersion: current?.entitlementVersion || 0 }); setSettings(await getMyCommissionSettings(ownerUid)); setMessage(`Asignación v${saved.version} guardada. El usuario puede elegir su distribución desde Mi cuenta.`); }
    catch (error: any) { setMessage(error.message || "No se pudo guardar la asignación."); } finally { setBusy(false); }
  }
  async function saveDaily(run = false) {
    if (busy || !automation) return;
    setBusy(true); setMessage("");
    try {
      if (run) { const result = await runDailyUserCommissionPreflight(); setMessage(result.reason ? `La corrida no inició: ${result.reason}.` : `Corrida revisada: ${result.scanned || 0} pagos. Consulta el estado individual de las solicitudes.`); }
      else { const result = await saveCommissionAutomationConfig({ ...automation, expectedVersion: automation.version }); setAutomation({ ...automation, version: result.version }); setMessage("Corte guardado. Se respetan los controles de preparación y envío seleccionados."); }
    } catch (error: any) { setMessage(error.message || "No se pudo guardar el corte."); } finally { setBusy(false); }
  }
  return <div className="mt-6 space-y-4 border-t border-white/10 pt-5">
    <h4 className="font-semibold">Comisiones personales por cliente</h4><p className="text-xs text-slate-400">Asigna al usuario y sus instrumentos verificados. Su derecho y porcentaje se leen del pago de referencia indicado arriba; esta asignación no crea utilidad ni cambia la jerarquía financiera.</p>
    <select className={`${style} w-full`} value={ownerUid} disabled={busy} onChange={event => setOwnerUid(event.target.value)}><option value="">Selecciona al usuario titular</option>{users.map(user => <option value={user.uid} key={user.uid}>{user.label}</option>)}</select>
    {ownerUid && <fieldset disabled={busy || loadingOwner || !settings} className="space-y-2 disabled:opacity-50"><p className="text-sm">{loadingOwner ? "Cargando asignación…" : current?.contractRateBps ? `Referencia contractual: ${(current.contractRateBps / 100).toFixed(2)} puntos.` : "Sin porcentaje comparable guardado; la modalidad de lo ganado estará disponible tras validar el pago."}</p>
      {methods.filter(method => method.active !== false).map(method => <label key={method.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={method.iqLinkStatus !== "VERIFIED"} checked={selected.includes(method.id)} onChange={event => setSelected(event.target.checked ? [...selected, method.id] : selected.filter(id => id !== method.id))} />{method.bankName} · {method.masked} · {method.iqLinkStatus === "VERIFIED" ? "Cuenta verificada" : "Requiere validaci?n"}</label>)}
      <label className="block text-sm"><input className="mr-2" type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} />Asignación activa</label><button type="button" disabled={!selected.length || !referencePaymentId.trim()} className="rounded-lg border border-sky-400/30 px-3 py-2 text-sm text-sky-200 disabled:opacity-40" onClick={() => void saveAssignment()}>Asignar cuentas y validar comisión</button>
    </fieldset>}
    {automation && <details className="rounded-xl border border-white/10 p-3"><summary className="text-sm font-semibold">Corte de preparación automática · toda la organización</summary><div className="mt-3 space-y-3"><p className="text-xs text-amber-200">Configura el corte acordado. Por defecto permanece inactivo. Al habilitar envíos se reserva la utilidad del usuario y se aplican los costos vigentes de Dispersiones.</p><p className="text-xs">Zona horaria: America/Mexico_City</p><label className="block text-sm">Hora de corte<input className={`${style} ml-2`} type="time" value={automation.cutoff || ""} onChange={event => setAutomation({ ...automation, cutoff: event.target.value })} /></label><label className="block text-sm">Incluir utilidades desde<input className={`${style} ml-2`} type="date" value={automation.startDate || ""} onChange={event => setAutomation({ ...automation, startDate: event.target.value })} /></label><div className="flex flex-wrap gap-3">{["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((day, index) => <label key={day} className="text-sm"><input className="mr-1" type="checkbox" checked={automation.weekdays.includes(index)} onChange={event => setAutomation({ ...automation, weekdays: event.target.checked ? [...automation.weekdays, index] : automation.weekdays.filter(item => item !== index) })} />{day}</label>)}</div><label className="block text-sm"><input type="checkbox" className="mr-2" checked={automation.enabled} onChange={event => setAutomation({ ...automation, enabled: event.target.checked })} />Preparación automática activa</label><label className="block text-sm"><input type="checkbox" className="mr-2" disabled={!automation.enabled} checked={automation.executionEnabled} onChange={event => setAutomation({ ...automation, executionEnabled: event.target.checked })} />Enviar comisiones automáticamente con los costos vigentes</label><div className="flex gap-2"><button type="button" disabled={busy} className={style} onClick={() => void saveDaily()}>Guardar corte</button><button type="button" disabled={busy || !automation.enabled} className={style} onClick={() => void saveDaily(true)}>Revisar corrida de hoy</button></div></div></details>}
    {message && <p role="status" className="text-sm text-slate-300">{message}</p>}
  </div>;
}
