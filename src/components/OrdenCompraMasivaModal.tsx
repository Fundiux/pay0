"use client";

import React, { useEffect, useMemo, useState } from "react";
import UiSelect, { UiSelectOption } from "@/components/UiSelect";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { mergeModules, normalizeRole } from "@/lib/roles";
import { listCompanies } from "@/services/companies";
import { listScopedClients } from "@/services/clients";
import { createSolicitud } from "@/services/solicitudes";
import { uploadSolicitudDoc } from "@/lib/uploadSolicitudDoc";
import {
  parseOrdenCompraWorkbookFile,
  type ParsedOrdenCompra,
} from "@/lib/ordenCompraParser";
import { parseFacturaXmlFile, type ParsedFacturaXml } from "@/lib/facturaXmlParser";
import { findFacturaSubtotalOperation } from "@/lib/solicitudes/operationOptions";

type PreviewStatus = "PENDIENTE" | "LISTA" | "ERROR" | "CREADA";
type SourceDocumentType = "ORDEN_COMPRA" | "FACTURA_XML";
type ParsedSolicitudSource = ParsedOrdenCompra | ParsedFacturaXml;

type PreviewRow = {
  key: string;
  file: File;
  sheetName: string;
  parsed: ParsedSolicitudSource;
  documentType: SourceDocumentType;
  clientOption: UiSelectOption | null;
  companyOption: (UiSelectOption & { despachoId?: string | null }) | null;
  operationOption: UiSelectOption | null;
  errors: string[];
  status: PreviewStatus;
  solicitudId?: string;
  folio?: string;
};

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function formatMoney(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "$0.00";

  return "$" + n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function isOcExcel(file: File) {
  const name = String(file.name || "").toLowerCase();
  return name.endsWith(".xlsx") || name.endsWith(".csv");
}

function isFacturaXml(file: File) {
  const name = String(file.name || "").toLowerCase();
  return name.endsWith(".xml");
}

function isSolicitudSourceFile(file: File) {
  return isOcExcel(file) || isFacturaXml(file);
}

function matchOptionByLabel<T extends UiSelectOption>(options: T[], target: unknown): T | null {
  const cleanTarget = normalizeText(target);
  if (!cleanTarget) return null;

  return (
    options.find((option) => {
      const label = normalizeText(option.label);
      const value = normalizeText(option.value);

      return (
        label === cleanTarget ||
        value === cleanTarget ||
        (cleanTarget.length >= 4 && label.includes(cleanTarget)) ||
        (label.length >= 4 && cleanTarget.includes(label))
      );
    }) || null
  );
}
export default function OrdenCompraMasivaModal(props: {
  open: boolean;
  files: File[];
  onClose: () => void;
  onFilesConsumed: () => void;
  replacementOf?: { solicitudId: string; folio?: string; reason?: string } | null;
}) {
  const { open, files, onClose, onFilesConsumed, replacementOf } = props;

  const { user } = useAuth();
  const { profile } = useUserProfile();
  const role = normalizeRole((profile as any)?.role) as any;
  const rootId = (profile as any)?.rootId || user?.uid;
  const uid = user?.uid;

  const modules = useMemo(
    () => mergeModules((profile as any)?.role, (profile as any)?.modules),
    [profile]
  );

  const canCreateSolicitud = !!modules?.solicitudes?.create;

  const [clients, setClients] = useState<any[]>([]);
  const [companies, setCompanies] = useState<any[]>([]);
  const [operationTypes, setOperationTypes] = useState<any[]>([]);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const clientOptions = useMemo<UiSelectOption[]>(
    () =>
      clients.map((client) => ({
        value: String(client.id || ""),
        label: String(
          client.name ||
            client.nombre ||
            client.razonSocial ||
            client.clienteNombre ||
            client.id ||
            "Cliente"
        ),
      })),
    [clients]
  );

  const companyOptions = useMemo<Array<UiSelectOption & { despachoId?: string | null }>>(
    () =>
      companies.map((company) => ({
        value: String(company.id || ""),
        label: String(
          company.name ||
            company.nombre ||
            company.razonSocial ||
            company.nombreComercial ||
            company.id ||
            "Empresa"
        ),
        despachoId: String(company.despachoId || "").trim() || null,
      })),
    [companies]
  );

  const operationOptions = useMemo<UiSelectOption[]>(
    () =>
      operationTypes.map((op: any) => ({
        value: String(op.key || op.id || ""),
        label: String(op.name || op.label || op.key || op.id || "Operacion"),
      })),
    [operationTypes]
  );

  const facturaSubtotalOperation = useMemo(
    () => findFacturaSubtotalOperation(operationOptions),
    [operationOptions]
  );

  useEffect(() => {
    if (!uid || !open || !rootId) return;

    const unsubClients = listScopedClients(
      { uid, role, rootId },
      (items) => setClients(items),
      () => setClients([])
    );

    const unsubCompanies = listCompanies(
      { uid, role },
      (items) => setCompanies(items),
      () => setCompanies([])
    );

    return () => {
      unsubClients();
      unsubCompanies();
    };
  }, [uid, role, rootId, open]);

  useEffect(() => {
    if (!open || !canCreateSolicitud) {
      setOperationTypes([]);
      return;
    }

    const qy = query(collection(db, "operationTypes"), orderBy("name"));

    return onSnapshot(qy, (snap) => {
      setOperationTypes(
        snap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter(
            (item: any) =>
              item?.active !== false &&
              String(item?.category || "OPERACION").toUpperCase() === "OPERACION"
          )
      );
    });
  }, [open, canCreateSolicitud]);

  useEffect(() => {
    if (!open) {
      setRows([]);
      setBusy(false);
      setSaving(false);
      setMessage("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || files.length === 0) return;
    if (clientOptions.length === 0 || companyOptions.length === 0 || operationOptions.length === 0) return;

    let cancelled = false;

    async function buildPreview() {
      setBusy(true);
      setMessage("Leyendo archivos...");

      try {
        const nextRows: PreviewRow[] = [];

        for (const file of files) {
          if (!isSolicitudSourceFile(file)) {
            nextRows.push({
              key: `${file.name}-invalid`,
              file,
              sheetName: "",
              parsed: {
                ok: false,
                sourceFileName: file.name,
                sheetName: "",
                clienteNombre: "",
                proveedorNombre: "",
                rfc: "",
                metodoPago: "",
                tipoFactura: "",
                moneda: "",
                formaPago: "",
                usoCfdi: "",
                subtotal: 0,
                iva: 0,
                total: 0,
                montoSolicitud: 0,
                conceptoPrincipal: "",
                referencia: file.name,
                operationTypeName: "Factura subtotal",
                warnings: ["Archivo no es Excel .xlsx, .csv o XML."],
              },
              documentType: "ORDEN_COMPRA",
              clientOption: null,
              companyOption: null,
              operationOption: facturaSubtotalOperation,
              errors: ["Archivo no es Excel .xlsx, .csv o XML."],
              status: "ERROR",
            });
            continue;
          }

          if (isFacturaXml(file)) {
            try {
              const parsed = await parseFacturaXmlFile(file);
              const clientOption = matchOptionByLabel(clientOptions, parsed.clienteNombre);
              const companyOption = matchOptionByLabel(companyOptions, parsed.proveedorNombre);
              const operationOption = facturaSubtotalOperation;

              const errors = Array.from(
                new Set(
                  [
                    clientOption ? "" : `Cliente no encontrado: ${parsed.clienteNombre || "-"}`,
                    companyOption ? "" : `Empresa no encontrada: ${parsed.proveedorNombre || "-"}`,
                    operationOption ? "" : "Tipo de operacion Factura subtotal no encontrado.",
                    parsed.tipoComprobante === "I" ? "" : "XML no es factura de ingreso.",
                    parsed.montoSolicitud > 0 ? "" : "Total XML no detectado.",
                    parsed.tipoFactura ? "" : "Tipo factura PUE/PPD no detectado.",
                    ...(parsed.warnings || []),
                  ].filter(Boolean)
                )
              );

              nextRows.push({
                key: `${file.name}-xml`,
                file,
                sheetName: "XML",
                parsed,
                documentType: "FACTURA_XML",
                clientOption,
                companyOption,
                operationOption,
                errors,
                status: errors.length > 0 ? "ERROR" : "LISTA",
              });
            } catch (err: any) {
              const errorText = err?.message || "No se pudo leer el XML.";

              nextRows.push({
                key: `${file.name}-xml-error`,
                file,
                sheetName: "XML",
                parsed: {
                  ok: false,
                  sourceFileName: file.name,
                  sheetName: "XML",
                  clienteNombre: "",
                  proveedorNombre: "",
                  rfc: "",
                  metodoPago: "",
                  tipoFactura: "",
                  moneda: "",
                  formaPago: "",
                  usoCfdi: "",
                  subtotal: 0,
                  iva: 0,
                  total: 0,
                  montoSolicitud: 0,
                  conceptoPrincipal: "",
                  referencia: file.name,
                  operationTypeName: "Factura subtotal",
                  warnings: [errorText],
                },
                documentType: "FACTURA_XML",
                clientOption: null,
                companyOption: null,
                operationOption: facturaSubtotalOperation,
                errors: [errorText],
                status: "ERROR",
              });
            }

            continue;
          }

          const parsedSheets = await parseOrdenCompraWorkbookFile(file);

          if (parsedSheets.length === 0) {
            nextRows.push({
              key: `${file.name}-empty`,
              file,
              sheetName: "",
              parsed: {
                ok: false,
                sourceFileName: file.name,
                sheetName: "",
                clienteNombre: "",
                proveedorNombre: "",
                rfc: "",
                metodoPago: "",
                tipoFactura: "",
                moneda: "",
                formaPago: "",
                usoCfdi: "",
                subtotal: 0,
                iva: 0,
                total: 0,
                montoSolicitud: 0,
                conceptoPrincipal: "",
                referencia: file.name,
                operationTypeName: "Factura subtotal",
                warnings: ["No se pudo leer la Orden de Compra."],
              },
              documentType: "ORDEN_COMPRA",
              clientOption: null,
              companyOption: null,
              operationOption: facturaSubtotalOperation,
              errors: ["No se pudo leer la Orden de Compra."],
              status: "ERROR",
            });
            continue;
          }

          parsedSheets.forEach((parsed, sheetIndex) => {
            const clientOption = matchOptionByLabel(clientOptions, parsed.clienteNombre);
            const companyOption = matchOptionByLabel(companyOptions, parsed.proveedorNombre);
            const operationOption = facturaSubtotalOperation;

            const errors = [
              clientOption ? "" : `Cliente no encontrado: ${parsed.clienteNombre || "-"}`,
              companyOption ? "" : `Empresa no encontrada: ${parsed.proveedorNombre || "-"}`,
              operationOption ? "" : "Tipo de operacion Factura subtotal no encontrado.",
              parsed.montoSolicitud > 0 ? "" : "Total OC no detectado.",
              parsed.tipoFactura ? "" : "Tipo factura PUE/PPD no detectado.",
            ].filter(Boolean);

            nextRows.push({
              key: `${file.name}-${parsed.sheetName || sheetIndex}`,
              file,
              sheetName: parsed.sheetName || `Hoja ${sheetIndex + 1}`,
              parsed,
              documentType: "ORDEN_COMPRA",
              clientOption,
              companyOption,
              operationOption,
              errors,
              status: errors.length > 0 ? "ERROR" : "LISTA",
            });
          });
        }

        if (!cancelled) {
          setRows(nextRows);
          setMessage(
            `Preview archivos: ${nextRows.filter((row) => row.status === "LISTA").length} lista(s), ${nextRows.filter((row) => row.status === "ERROR").length} con error.`
          );
          onFilesConsumed();
        }
      } catch (err: any) {
        console.error("[OrdenCompraMasivaModal] preview error", err);
        if (!cancelled) {
          setMessage(err?.message || "No se pudieron leer los archivos.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }

    void buildPreview();

    return () => {
      cancelled = true;
    };
  }, [
    open,
    files,
    clientOptions,
    companyOptions,
    operationOptions,
    facturaSubtotalOperation,
    onFilesConsumed,
  ]);

  const validRows = rows.filter((row) => row.status === "LISTA");
  const errorRows = rows.filter((row) => row.status === "ERROR");
  const createdRows = rows.filter((row) => row.status === "CREADA");

  async function handleCreateValidRows() {
    if (saving || busy) return;
    if (!canCreateSolicitud) {
      setMessage("No tienes permiso para crear solicitudes.");
      return;
    }

    const targets = rows.filter((row) => row.status === "LISTA");

    if (targets.length === 0) {
      setMessage("No hay archivos validos para crear solicitudes.");
      return;
    }

    setSaving(true);
    setMessage(`Creando ${targets.length} solicitud(es)...`);

    let created = 0;

    for (const row of targets) {
      try {
        if (!row.clientOption || !row.companyOption || !row.operationOption) {
          throw new Error("Fila sin cliente, empresa o tipo de operacion.");
        }

        const sourceLabel = row.documentType === "FACTURA_XML" ? "XML" : "OC";

        const createResult: any = await createSolicitud({
          clienteId: row.clientOption.value,
          companyId: row.companyOption.value,
          despachoId: String(row.companyOption.despachoId || "").trim(),
          operationTypeKey: row.operationOption.value,
          monto: row.parsed.montoSolicitud,
          tipoFactura: row.parsed.tipoFactura || "PPD",
          comentario: [
            row.parsed.referencia || `${sourceLabel} ${row.file.name}`,
            row.documentType === "ORDEN_COMPRA" ? `Hoja ${row.sheetName}` : "",
            row.parsed.subtotal ? `Subtotal ${sourceLabel} ${row.parsed.subtotal}` : "",
            row.parsed.total ? `Total ${sourceLabel} ${row.parsed.total}` : "",
            `Tipo operacion ${sourceLabel}: Factura subtotal`,
          ].filter(Boolean).join(" | "),
          clienteNombre: row.clientOption.label,
          empresaNombre: row.companyOption.label,
          replacementOfSolicitudId: replacementOf?.solicitudId || undefined,
          replacementReason: replacementOf?.reason || undefined,
        });

        const solicitudId = String(
          createResult?.data?.solicitudId ||
            createResult?.solicitudId ||
            createResult?.data?.id ||
            ""
        ).trim();

        const folio = String(createResult?.data?.folio || createResult?.folio || "").trim();

        if (!solicitudId) {
          throw new Error("Solicitud creada sin solicitudId para adjuntar archivo fuente.");
        }

        // A54-A13-R1 PUBLICACION_MASIVA_INMEDIATA

        // La solicitud ya existe en PAY0: publicamos fila y dejamos la OC en segundo plano.

        window.dispatchEvent(

          new CustomEvent("PAY0_SOLICITUD_CREATED_LOCAL", {

            detail: {

              solicitudId,

              folio,

            },

          })

        );

        

        void (async () => {

          try {

            await uploadSolicitudDoc({

              solicitudId,

              documentType: row.documentType,

              file: row.file,

            });

        

            console.info("[PAY0_SOLICITUD_MASIVA_DOCUMENTO_ASYNC_OK]", {

              solicitudId,

              folio,

              documentType: row.documentType,

              fileName: row.file.name,

            });

          } catch (uploadError) {

            console.error("[PAY0_SOLICITUD_MASIVA_DOCUMENTO_ASYNC_ERROR]", {

              solicitudId,

              folio,

              documentType: row.documentType,

              fileName: row.file.name,

              error: uploadError,

            });

          }

        })();

        created += 1;

        setRows((prev) =>
          prev.map((item) =>
            item.key === row.key
              ? {
                  ...item,
                  status: "CREADA",
                  solicitudId,
                  folio,
                }
              : item
          )
        );

        setMessage(`Creadas ${created}/${targets.length} solicitud(es).`);
      } catch (err: any) {
        const errorText = err?.message || "No se pudo crear la solicitud.";

        setRows((prev) =>
          prev.map((item) =>
            item.key === row.key
              ? {
                  ...item,
                  status: "ERROR",
                  errors: [...item.errors, errorText],
                }
              : item
          )
        );
      }
    }

    setSaving(false);

    if (created === targets.length) {
      setMessage(`Proceso terminado. Creadas ${created}/${targets.length} solicitud(es). Cerrando...`);
      onClose();
return;
    }

    setMessage(`Proceso terminado. Creadas ${created}/${targets.length} solicitud(es). Revisa errores.`);
  }

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (saving) return;
      onClose();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, saving, onClose]);

  function closeModal() {
    if (saving) return;
    onClose();
  }
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        closeModal();
      }}
    >
      <div className="relative flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-[980px] flex-col rounded-3xl border border-white/10 bg-[#161d2b] shadow-2xl">
        <button
          type="button"
          onClick={closeModal}
          disabled={saving}
          className="absolute -right-2 -top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400 shadow-lg shadow-black/40 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
          title="Cerrar"
          aria-label="Cerrar"
        >
          X
        </button>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-3 gap-2 text-[12px]">
            <div className="rounded-xl border border-white/10 bg-[#0b1220] p-3">
              <div className="text-slate-500">Listas</div>
              <div className="text-lg text-emerald-300">{validRows.length}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0b1220] p-3">
              <div className="text-slate-500">Errores</div>
              <div className="text-lg text-rose-300">{errorRows.length}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-[#0b1220] p-3">
              <div className="text-slate-500">Creadas</div>
              <div className="text-lg text-sky-300">{createdRows.length}</div>
            </div>
          </div>

          {message ? (
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-slate-300">
              {message}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[920px] text-left text-[12px]">
              <thead className="bg-white/5 text-[11px] uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Archivo / Hoja</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Factura</th>
                  <th className="px-3 py-2">Estatus</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-5 text-center text-slate-500">
                      {busy ? "Leyendo archivos..." : "Suelta OC o XML en Solicitudes."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.key} className="border-t border-white/5 align-top">
                      <td className="px-3 py-2">
                        <div className="text-white">{row.file.name}</div>
                        <div className="text-slate-500">{row.sheetName || "-"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className={row.clientOption ? "text-slate-200" : "text-rose-300"}>
                          {row.clientOption?.label || row.parsed.clienteNombre || "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className={row.companyOption ? "text-slate-200" : "text-rose-300"}>
                          {row.companyOption?.label || row.parsed.proveedorNombre || "-"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-200">{formatMoney(row.parsed.montoSolicitud)}</td>
                      <td className="px-3 py-2 text-slate-200">{row.parsed.tipoFactura || "-"}</td>
                      <td className="px-3 py-2">
                        <div
                          className={
                            row.status === "CREADA"
                              ? "text-sky-300"
                              : row.status === "LISTA"
                                ? "text-emerald-300"
                                : "text-rose-300"
                          }
                        >
                          {row.status}
                        </div>
                        {row.folio ? <div className="text-slate-500">{row.folio}</div> : null}
                        {row.errors.length > 0 ? (
                          <div className="mt-1 space-y-1 text-[11px] text-rose-300">
                            {row.errors.map((error, index) => (
                              <div key={`${row.key}-err-${index}`}>{error}</div>
                            ))}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button
            type="button"
            onClick={handleCreateValidRows}
            disabled={busy || saving || validRows.length === 0 || !canCreateSolicitud}
            className="rounded-xl bg-sky-500 px-4 py-2 text-[12px] font-normal text-black transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Creando..." : `Crear ${validRows.length} solicitud(es)`}
          </button>
        </div>
      </div>
    </div>
  );
}
