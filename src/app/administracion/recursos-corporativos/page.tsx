"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import DocumentDossier from "@/components/corporate-resources/DocumentDossier";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole } from "@/lib/roles";
import { changeCorporateVersion, cloneCorporateTemplateBase, downloadCorporateResource, getCorporateResource, importCorporateResource, reviseCorporateTemplate,
  listCorporateResources, prepareCorporateResourceMigration, uploadCorporateResource,
  type CorporateCompany, type CorporateResource, type CorporateVersion } from "@/services/corporateResources";

const statusName: Record<string, string> = { DRAFT: "Borrador", REVIEW: "En revisión", APPROVED: "Aprobada", ACTIVE: "Publicada", RETIRED: "Archivada" };
const templateNames: Record<string, string> = { COTIZACION: "Cotización", CONSTANCIA_ENTREGA_BIENES: "Constancia de entrega", CONSTANCIA_SERVICIO: "Constancia de servicio", ORDEN_COMPRA: "Orden de compra", FACTURA: "Factura", CONTRATO: "Contrato", OTRO: "Otro documento" };
const field = "rounded-lg border border-white/15 bg-slate-950 p-2 text-sm text-white";
const button = "rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-40";

export default function CorporateResourcesPage() {
  const { profile, loading } = useUserProfile();
  const [resources, setResources] = useState<CorporateResource[]>([]), [companies, setCompanies] = useState<CorporateCompany[]>([]);
  const [companyId, setCompanyId] = useState(""), [selected, setSelected] = useState<CorporateResource | null>(null);
  const [versions, setVersions] = useState<CorporateVersion[]>([]), [history, setHistory] = useState<Array<{ id: string; action: string; version: number; createdAt: string }>>([]);
  const [candidates, setCandidates] = useState<Array<{ use: string; templateId: string; templateVersion: string; templateBundleSha256: string }>>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [title, setTitle] = useState(""), [key, setKey] = useState(""), [kind, setKind] = useState("OWN_COMPANY_DOCUMENT"), [file, setFile] = useState<File | null>(null);
  const [templateType, setTemplateType] = useState("COTIZACION");
  const [heading, setHeading] = useState(""), [footer, setFooter] = useState(""), [accent, setAccent] = useState("#183652"), [notes, setNotes] = useState("");
  const allowed = normalizeRole(profile?.role) === "superadmin";
  async function refresh(id?: string) {
    const result = await listCorporateResources();
    setResources(result.resources); setCompanies(result.companies);
    if (result.truncated) setMessage("Se muestran hasta 500 recursos. El inventario supera el límite de esta vista.");
    if (id) { const detail = await getCorporateResource(id); setSelected(detail.resource); setVersions(detail.versions); setHistory(detail.history);
      setHeading(detail.versions[0]?.payload?.heading || companies.find(row => row.id === detail.resource.ownCompanyId)?.name || "");
      setFooter(detail.versions[0]?.payload?.footer || ""); setAccent(detail.versions[0]?.payload?.accent || "#183652"); }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e: any) { setError(e?.message || "No se pudo completar la operación."); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (!loading && allowed) void run(() => refresh()); }, [loading, allowed]);
  if (loading) return <p className="p-6 text-slate-300">Cargando recursos…</p>;
  if (!allowed) return <p className="p-6 text-slate-300">No tienes acceso a la administración de recursos corporativos.</p>;
  const visible = resources.filter(row => !companyId || row.ownCompanyId === companyId);
  return <main className="mx-auto max-w-7xl space-y-6 p-5 text-slate-100">
    <header><h1 className="text-2xl font-semibold">Recursos corporativos</h1><p className="mt-1 text-sm text-slate-400">Plantillas, identidad y documentos de empresas propias. Cada cambio conserva una versión; aprobar y activar son acciones separadas.</p></header>
    <div className="flex flex-wrap gap-3"><label className="text-sm">Empresa propia <select className={`${field} ml-2`} value={companyId} onChange={e => { setCompanyId(e.target.value); setCandidates([]); }}>
      <option value="">Todas las empresas</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name} · {company.rfc}</option>)}</select></label>
      <button className={button} disabled={busy || !companyId} onClick={() => void run(async () => { const result = await prepareCorporateResourceMigration(companyId); setCandidates(result.candidates); setMessage(result.reason || "Inventario preparado sin modificar los recursos activos."); })}>Revisar canónicos existentes</button>
      <button className={button} disabled={busy} onClick={() => void run(() => refresh(selected?.id))}>Actualizar</button></div>
    {companyId && <section className="rounded-xl border border-white/10 p-4"><h2 className="font-semibold">Plantillas y documentos de {companies.find(row => row.id === companyId)?.name}</h2>
      <p className="mt-1 text-sm text-slate-400">Clona una base global, revisa su archivo y publícala para documentos nuevos. Las versiones emitidas conservan su referencia histórica.</p>
      <div className="mt-3 flex flex-wrap gap-3"><select className={field} aria-label="Tipo documental" value={templateType} onChange={event => setTemplateType(event.target.value)}>{Object.entries(templateNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button className={button} disabled={busy} onClick={() => void run(async () => { const result = await cloneCorporateTemplateBase(companyId, templateType); await refresh(result.resourceId); setMessage("Plantilla base clonada en revisión. Comprueba el archivo antes de aprobar y publicar."); })}>Clonar plantilla base</button></div>
    </section>}
    {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-950/30 p-3 text-red-200">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-950/30 p-3 text-emerald-200">{message}</p>}
    {!companies.length && <p className="rounded-lg border border-amber-400/30 p-4 text-sm text-amber-100">No hay empresas propias activas en tu ámbito. Su propiedad debe estar identificada en el catálogo antes de administrar recursos.</p>}
    <DocumentDossier />
    <section className="grid gap-3 md:grid-cols-3">
      <div className="rounded-xl border border-white/10 p-4"><h2 className="font-semibold">Documentos y plantillas</h2><p className="mt-1 text-sm text-slate-400">Versiona, aprueba, activa, descarga y reutiliza archivos por empresa propia.</p></div>
      <div className="rounded-xl border border-white/10 p-4"><h2 className="font-semibold">Catálogo fiscal emisor</h2><p className="mt-1 text-sm text-slate-400">El catálogo SAT por empresa propia conserva su flujo fiscal especializado.</p><Link href="/facturacion" className="mt-3 inline-block text-sm text-cyan-300 hover:text-cyan-200">Abrir facturación y catálogo</Link></div>
      <div className="rounded-xl border border-white/10 p-4"><h2 className="font-semibold">Integraciones y parámetros</h2><p className="mt-1 text-sm text-slate-400">Las referencias IQ, Facturama y secretos permanecen en sus módulos seguros; aquí se consulta su recurso corporativo, sin copiar credenciales.</p></div>
    </section>
    {candidates.length > 0 && <section className="rounded-xl border border-white/10 p-4"><h2 className="font-semibold">Preparación de migración</h2><p className="mb-3 text-sm text-slate-400">Importar crea una versión en revisión. El generador actual sigue usando su fuente hasta que actives la nueva versión.</p>
      <div className="grid gap-3 md:grid-cols-3">{candidates.map(candidate => <article key={candidate.use} className="rounded-lg bg-white/5 p-3"><p className="font-medium">{candidate.use.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-400">Versión {candidate.templateVersion}</p><details className="my-2 text-xs"><summary>Integridad del paquete</summary><p className="break-all">SHA-256: {candidate.templateBundleSha256}</p></details><button className={button} disabled={busy} onClick={() => void run(async () => { const result = await importCorporateResource(companyId, candidate.use); await refresh(result.resourceId); setMessage("Versión importada. Revisa el PDF de referencia antes de aprobar y activar."); })}>Importar para revisión</button></article>)}</div></section>}
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]"><section className="space-y-2"><h2 className="font-semibold">Recursos disponibles ({visible.length})</h2>
      {visible.map(row => <button key={row.id} className={`w-full rounded-lg border p-3 text-left hover:bg-white/5 ${selected?.id === row.id ? "border-cyan-400/60 bg-cyan-950/30" : "border-white/10"}`} onClick={() => void run(() => refresh(row.id))} disabled={busy}><p className="text-sm font-medium">{row.resourceKind === "DOCUMENT_TEMPLATE" ? templateNames[row.stableKey] || row.title : row.title}</p><p className="mt-1 text-xs text-slate-400">{row.activeVersion ? `Publicada: v${row.activeVersion}` : "Sin versión publicada"} · {row.latestVersion} versiones</p></button>)}
      {!visible.length && <p className="text-sm text-slate-400">Importa un canónico existente o carga un recurso para comenzar.</p>}
    </section><section className="rounded-xl border border-white/10 p-4"><h2 className="font-semibold">{selected?.title || "Selecciona un recurso"}</h2>
      {versions.map(version => <article key={version.id} className="mt-4 rounded-lg bg-white/5 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Versión {version.version}</h3><span className="text-xs text-cyan-200">{statusName[version.status] || version.status}</span></div>
        <p className="mt-1 text-xs text-slate-400">{version.createdByName || "Usuario"} · {version.createdAt ? new Date(version.createdAt).toLocaleDateString("es-MX") : "Fecha pendiente"}</p>
        <p className="mt-2 text-sm text-slate-400">{version.comment}</p><div className="mt-3 flex flex-wrap gap-2">
          {version.artifacts?.map(artifact => <button className={button} key={artifact.name} disabled={busy} onClick={() => void run(async () => { const result = await downloadCorporateResource(selected!.id, version.version, artifact.name); window.open(result.url, "_blank", "noopener,noreferrer"); })}>Descargar {artifact.name}</button>)}
          {version.status === "REVIEW" && <button className={button} disabled={busy} onClick={() => void run(async () => { await changeCorporateVersion("approve", selected!.id, version.version); await refresh(selected!.id); })}>Aprobar versión</button>}
          {version.status === "APPROVED" && <button className={`${button} bg-cyan-900/50`} disabled={busy} onClick={() => void run(async () => { await changeCorporateVersion("activate", selected!.id, version.version); await refresh(selected!.id); setMessage(selected?.resourceKind === "DOCUMENT_TEMPLATE" || selected?.stableKey === "LOGO" ? "Version activa para los documentos nuevos." : "Version activa disponible para consulta."); })}>Activar versión</button>}
          {version.status === "RETIRED" && <button className={button} disabled={busy} onClick={() => void run(async () => { await changeCorporateVersion("restore", selected!.id, version.version); await refresh(selected!.id); setMessage("Se creó otra versión en revisión; el historial se conservó."); })}>Restaurar como versión nueva</button>}
          {version.status === "ACTIVE" && <button className={button} disabled={busy} onClick={() => { if (window.confirm("Al retirar la versión activa, este recurso dejará de estar disponible para generar documentos hasta activar otra. ¿Retirar?")) void run(async () => { await changeCorporateVersion("retire", selected!.id, version.version); await refresh(selected!.id); }); }}>Retirar</button>}
        </div>{version.contentDigest && <details className="mt-3 text-xs text-slate-400"><summary>Integridad</summary><p className="break-all">SHA-256: {version.contentDigest}</p></details>}</article>)}
      {history.length > 0 && <details className="mt-5 text-sm"><summary>Historial de decisiones</summary><ul className="mt-2 space-y-1 text-xs text-slate-400">{history.map(item => <li key={item.id}>{item.createdAt} · v{item.version} · {item.action}</li>)}</ul></details>}
      {selected?.resourceKind === "DOCUMENT_TEMPLATE" && <div className="mt-5 rounded-lg border border-white/10 p-3"><h3 className="font-medium">Nueva versión editable</h3><p className="mt-1 text-xs text-slate-400">Edita título, pie y color. La versión publicada y los documentos anteriores no cambian.</p><div className="mt-3 grid gap-2"><input className={field} aria-label="Título de plantilla" value={heading} maxLength={120} onChange={event => setHeading(event.target.value)} /><input className={field} aria-label="Pie de plantilla" value={footer} maxLength={300} onChange={event => setFooter(event.target.value)} placeholder="Pie opcional" /><input className={field} aria-label="Color de plantilla" value={accent} maxLength={7} onChange={event => setAccent(event.target.value)} placeholder="#183652" /><input className={field} aria-label="Notas de la versión" value={notes} maxLength={500} onChange={event => setNotes(event.target.value)} placeholder="Motivo del cambio" /></div><button className={`${button} mt-3`} disabled={busy || !heading || !/^#[0-9a-fA-F]{6}$/.test(accent)} onClick={() => void run(async () => { await reviseCorporateTemplate({ resourceId: selected.id, expectedLatest: selected.latestVersion, heading, footer, accent, notes }); await refresh(selected.id); setMessage("Nueva versión en revisión; aprueba y publica cuando esté verificada."); })}>Crear nueva versión</button></div>}
    </section></div>
    <section className="rounded-xl border border-white/10 p-4"><h2 className="font-semibold">Nueva versión de documento o imagen</h2><p className="mt-1 text-sm text-slate-400">Usa la misma clave para versionar un recurso existente. La carga se revisa antes de activarse. No cargues credenciales, CSD, e.firma ni llaves privadas.</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2"><input className={field} aria-label="Nombre del recurso" value={title} onChange={e => setTitle(e.target.value)} placeholder={kind === "DOCUMENT_TEMPLATE" ? "Nombre opcional de la plantilla" : "Nombre del recurso"} maxLength={180}/>{kind !== "DOCUMENT_TEMPLATE" && <input className={field} aria-label="Clave del recurso" value={key} onChange={e => setKey(e.target.value.toUpperCase())} placeholder="Clave estable, por ejemplo LOGO o CSF" maxLength={80}/>}<select className={field} value={kind} onChange={e => setKind(e.target.value)}><option value="OWN_COMPANY_DOCUMENT">Documento corporativo</option><option value="DOCUMENT_TEMPLATE">Plantilla documental PDF</option><option value="BRAND_STATIONERY">Imagen corporativa</option></select><input className={field} type="file" accept={kind === "DOCUMENT_TEMPLATE" ? "application/pdf" : "application/pdf,image/png,image/jpeg"} onChange={e => setFile(e.target.files?.[0] || null)}/></div>
      {kind === "DOCUMENT_TEMPLATE" && ["COTIZACION", "CONSTANCIA_ENTREGA_BIENES", "CONSTANCIA_SERVICIO"].includes(templateType) && <p className="mt-2 text-sm text-amber-200">Cotizaciones y constancias se editan arriba como versión estructurada; un PDF suelto no sirve como plantilla de generación.</p>}
      <button className={`${button} mt-3`} disabled={busy || !companyId || (kind !== "DOCUMENT_TEMPLATE" && (!title || !key)) || (kind === "DOCUMENT_TEMPLATE" && ["COTIZACION", "CONSTANCIA_ENTREGA_BIENES", "CONSTANCIA_SERVICIO"].includes(templateType)) || !file} onClick={() => void run(async () => { const result = await uploadCorporateResource({ companyId, kind, key: kind === "DOCUMENT_TEMPLATE" ? templateType : key, title: title || templateNames[templateType], file: file! }); await refresh(result.resourceId); setMessage("Archivo validado. La versión está en revisión."); })}>Cargar para revisión</button>
    </section>
  </main>;
}
