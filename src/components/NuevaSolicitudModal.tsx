"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import UiSelect, { UiSelectOption } from "@/components/UiSelect";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebaseClient";

function isPermissionDeniedError(e: any) {
  const code = String(e?.code || "").toLowerCase();
  const message = String(e?.message || "").toLowerCase();
  return code.includes("permission-denied") || message.includes("permission-denied");
}
import { beginOperationTiming } from "@/lib/operationTiming";
import { createSolicitud } from "@/services/solicitudes";
import { useAuth } from "@/lib/auth";
import { useUserProfile } from "@/lib/useUserProfile";
import { normalizeRole, mergeModules } from "@/lib/roles";
import { UploadCloud, X } from "lucide-react";
import { listCompanies } from "@/services/companies";
import { listScopedClients } from "@/services/clients";
import { uploadSolicitudDoc } from "@/lib/uploadSolicitudDoc";
import { parseOrdenCompraFile, type ParsedOrdenCompra } from "@/lib/ordenCompraParser";
import { parseFacturaXmlFile, type ParsedFacturaXml } from "@/lib/facturaXmlParser";
import { findFacturaSubtotalOperation } from "@/lib/solicitudes/operationOptions";

// H4_D87_A57_A78_NUEVA_SOLICITUD_LEGACY_IQ_IMPORT_REMOVED
export default function NuevaSolicitudModal({ open, onClose, variant = "default" }: { open: boolean; onClose: () => void; variant?: "default" | "mat" }) {
  const { user } = useAuth();
  const { profile } = useUserProfile();
  const role = normalizeRole((profile as any)?.role) as any;

  const [clientes, setClientes] = useState<any[]>([]);
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [operationTypes, setOperationTypes] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submission = useRef<{ solicitudId: string; folio: string } | null>(null);
  const saving = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [sourceCompanyWarning, setSourceCompanyWarning] = useState("");
  const [sourceCompanyConfirmed, setSourceCompanyConfirmed] = useState(false);
  const parseSequence = useRef(0);
  const [ordenCompraFile, setOrdenCompraFile] = useState<File | null>(null);
  const [facturaXmlFile, setFacturaXmlFile] = useState<File | null>(null);
  const [ordenCompraDragging, setOrdenCompraDragging] = useState(false);
  const [ordenCompraUploadPct, setOrdenCompraUploadPct] = useState(0);
  const [ordenCompraParseBusy, setOrdenCompraParseBusy] = useState(false);
  const [ordenCompraParseMsg, setOrdenCompraParseMsg] = useState("");
  const [ordenCompraParsed, setOrdenCompraParsed] = useState<ParsedOrdenCompra | null>(null);
  const [facturaXmlParsed, setFacturaXmlParsed] = useState<ParsedFacturaXml | null>(null);

  const initialFormData = {
    clientId: "",
    clientName: "Selecciona Cliente",
    companyId: "",
    companyName: "Selecciona Empresa",
    operationTypeKey: "",
    operationTypeName: "Selecciona tipo de operacion",
    tipoFactura: "PUE",
    monto: "",
    comentario: "",
  };

  const [formData, setFormData] = useState(initialFormData);

  const rootId = (profile as any)?.rootId || user?.uid;
  const uid = user?.uid;

  const modules = useMemo(
    () => mergeModules((profile as any)?.role, (profile as any)?.modules),
    [profile]
  );

  const canCreateSolicitud = !!modules?.solicitudes?.create;

  const selectedCompany = useMemo(() => {
    return empresas.find((x) => String(x?.id || "") === String(formData.companyId || "")) || null;
  }, [empresas, formData.companyId]);

  const hasSourceDocument = Boolean(ordenCompraFile || facturaXmlFile);
  const sourceDocumentLock = hasSourceDocument || ordenCompraParseBusy || isSubmitting;

  const clientOptions = useMemo<UiSelectOption[]>(
    () =>
      clientes.map((c) => ({
        value: String(c.id || ""),
        label: String(c.name || "Sin nombre"),
      })),
    [clientes]
  );

  const companyOptions = useMemo<UiSelectOption[]>(
    () =>
      empresas.map((e) => ({
        value: String(e.id || ""),
        label: String(e.name || e.nombre || "Sin nombre"),
      })),
    [empresas]
  );

  const operationOptions = useMemo<UiSelectOption[]>(
    () =>
      operationTypes.map((op: any) => ({
        value: String(op.key || op.id || ""),
        label: String(op.name || op.label || op.key || "Operación sin nombre"),
      })),
    [operationTypes]
  );

  const tipoFacturaOptions = useMemo<UiSelectOption[]>(
    () => [
      { value: "PUE", label: "PUE" },
      { value: "PPD", label: "PPD" },
    ],
    []
  );

  useEffect(() => {
    const warnPending = (event: BeforeUnloadEvent) => {
      if (!saving.current && !submission.current) return;
      event.preventDefault(); event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnPending);
    return () => window.removeEventListener("beforeunload", warnPending);
  }, []);

  const resetForm = () => {
    parseSequence.current++;
    setSourceCompanyWarning("");
    submission.current = null;
    setSaveError("");
    setFormData(initialFormData);
    setOrdenCompraFile(null);
    setFacturaXmlFile(null);
    setOrdenCompraDragging(false);
    setOrdenCompraUploadPct(0);
    setOrdenCompraParseBusy(false);
    setOrdenCompraParseMsg("");
    setOrdenCompraParsed(null);
    setFacturaXmlParsed(null);
    setIsSubmitting(false);
  };

  useEffect(() => {
    if (!uid || !open || !rootId) return;

    const unsubC = listScopedClients(
      { uid, role, rootId },
      (items) => setClientes(items),
      (err) => {
        console.error("[NuevaSolicitudModal] clients error:", err);
        setClientes([]);
      }
    );

    const unsubE = listCompanies(
      { uid, role },
      (items) =>
        setEmpresas(
          items.map((x) => ({
            id: x.id,
            nombre: x.nombre,
            despachoId: x.despachoId || null,
          }))
        ),
      (err) => {
        if (!isPermissionDeniedError(err)) {
          console.error("[NuevaSolicitudModal] companies error:", err);
        }
        setEmpresas([]);
      }
    );

    return () => {
      unsubC();
      unsubE();
    };
  }, [uid, rootId, open, role, profile]);

  useEffect(() => {
    if (!open || !canCreateSolicitud) {
      setOperationTypes([]);
      return;
    }

    const qy = query(collection(db, "operationTypes"), orderBy("name"));
    return onSnapshot(qy, (snap) => {
      setOperationTypes(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter(
            (x: any) =>
              x?.active !== false &&
              String(x?.category || "OPERACION").toUpperCase() === "OPERACION"
          )
      );
    });
  }, [open, canCreateSolicitud]);

  useEffect(() => {
    if (open) resetForm();
  }, [open]);

  const handleMontoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (sourceDocumentLock) return;

    let val = e.target.value.replace(/,/g, "").replace(/[^\d.]/g, "");
    const parts = val.split(".");
    if (parts.length > 2) {
      val = parts[0] + "." + parts.slice(1).join("");
    }
    if (val.includes(".")) {
      const [entero, decimales] = val.split(".");
      val = entero + "." + String(decimales || "").slice(0, 2);
    }
    setFormData({ ...formData, monto: val });
  };

  const handleMontoBlur = () => {
    if (sourceDocumentLock) return;

    const raw = String(formData.monto || "").replace(/,/g, "").trim();
    if (!raw) return;

    const num = Number(raw);
    if (!Number.isFinite(num)) {
      setFormData({ ...formData, monto: "" });
      return;
    }

    setFormData({
      ...formData,
      monto: num.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    });
  };

  const normalizeOcText = (value: unknown) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const parseOcMoney = (value: unknown) => {
    const raw = String(value || "").trim();
    if (!raw) return null;

    const clean = raw.replace(/[^0-9,.-]/g, "");
    if (!clean) return null;

    const comma = clean.lastIndexOf(",");
    const dot = clean.lastIndexOf(".");
    const normalized = comma > dot
      ? clean.replace(/\./g, "").replace(",", ".")
      : clean.replace(/,/g, "");

    const n = Number(normalized);
    if (!Number.isFinite(n) || n <= 0) return null;

    return Math.round(n * 100) / 100;
  };

  const matchOcAlias = (value: unknown, aliases: string[]) => {
    const key = normalizeOcText(value);
    if (!key) return false;

    return aliases.some((alias) => {
      const a = normalizeOcText(alias);
      return key === a || key.includes(a);
    });
  };

  const findOcValue = (rows: any[][], aliases: string[]) => {
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;

      if (matchOcAlias(row[0], aliases)) {
        const value = row[1];
        if (String(value || "").trim()) return value;
      }
    }

    const maxHeaderRows = Math.min(rows.length, 10);

    for (let headerIndex = 0; headerIndex < maxHeaderRows; headerIndex++) {
      const header = rows[headerIndex] || [];
      const colIndex = header.findIndex((cell) => matchOcAlias(cell, aliases));

      if (colIndex < 0) continue;

      for (let rowIndex = headerIndex + 1; rowIndex < Math.min(rows.length, headerIndex + 8); rowIndex++) {
        const value = rows[rowIndex]?.[colIndex];
        if (String(value || "").trim()) return value;
      }
    }

    return "";
  };

  const matchOptionByLabel = (options: UiSelectOption[], target: unknown) => {
    const cleanTarget = normalizeOcText(target);
    if (!cleanTarget) return null;

    return (
      options.find((option) => {
        const label = normalizeOcText(option.label);
        const value = normalizeOcText(option.value);
        return (
          label === cleanTarget ||
          value === cleanTarget ||
          (cleanTarget.length >= 4 && label.includes(cleanTarget)) ||
          (label.length >= 4 && cleanTarget.includes(label))
        );
      }) || null
    );
  };  const applyOrdenCompraAutofill = async (file: File) => {
    setOrdenCompraParseBusy(true);
    setOrdenCompraParseMsg("Leyendo Orden de Compra...");

    setSourceCompanyConfirmed(false);
    const sequence = ++parseSequence.current;
    try {
      const parsed = await parseOrdenCompraFile(file);
      if (sequence !== parseSequence.current) return;
      setOrdenCompraParsed(parsed);

      const matchedClient = matchOptionByLabel(clientOptions, parsed.clienteNombre);
      const matchedCompany = matchOptionByLabel(companyOptions, parsed.proveedorNombre);
      const matchedOperation = findFacturaSubtotalOperation(operationOptions);
      setSourceCompanyWarning(formData.companyId && matchedCompany && formData.companyId !== matchedCompany.value
        ? `Empresa seleccionada: ${formData.companyName}. El documento corresponde a ${matchedCompany.label}; el formulario cambio a la empresa del documento. Verifica antes de crear.` : "");

      const filled: string[] = [matchedClient && "cliente", matchedCompany && "empresa", matchedOperation && "tipo de operacion", parsed.montoSolicitud > 0 && "monto total", parsed.tipoFactura && "tipo factura"].filter(Boolean) as string[];

      setFormData((prev) => {
        const next = {
          ...prev,
          clientId: "",
          clientName: "Selecciona Cliente",
          companyId: "",
          companyName: "Selecciona Empresa",
          operationTypeKey: "",
          operationTypeName: "Selecciona tipo de operacion",
          tipoFactura: "PUE",
          monto: "",
          comentario: "",
        };

        if (matchedClient) {
          next.clientId = matchedClient.value;
          next.clientName = matchedClient.label;
        }

        if (matchedCompany) {
          next.companyId = matchedCompany.value;
          next.companyName = matchedCompany.label;
        }

        if (matchedOperation) {
          next.operationTypeKey = matchedOperation.value;
          next.operationTypeName = matchedOperation.label;
        }

        if (parsed.montoSolicitud > 0) {
          next.monto = parsed.montoSolicitud.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        }

        if (parsed.tipoFactura === "PUE" || parsed.tipoFactura === "PPD") {
          next.tipoFactura = parsed.tipoFactura;
        }

        const note = [
          parsed.referencia || `OC ${file.name}`,
          parsed.subtotal ? `Subtotal OC ${parsed.subtotal}` : "",
          parsed.total ? `Total OC ${parsed.total}` : "",
          "Tipo operacion OC: Factura subtotal",
        ].filter(Boolean).join(" | ");

        if (!String(next.comentario || "").trim()) {
          next.comentario = note;
        }

        return next;
      });

      const missing = [
        matchedClient ? "" : "cliente",
        matchedCompany ? "" : "empresa",
        matchedOperation ? "" : "tipo de operacion Factura subtotal",
        parsed.montoSolicitud > 0 ? "" : "total OC",
      ].filter(Boolean);

      if (filled.length > 0) {
        setOrdenCompraParseMsg(
          missing.length > 0
            ? `OC leida. Autollenado: ${filled.join(", ")}. Falta revisar: ${missing.join(", ")}.`
            : `OC leida. Autollenado completo usando TOTAL OC y Factura subtotal.`
        );
      } else {
        setOrdenCompraParseMsg("OC cargada. No pude autollenar campos; corrige el archivo o catalogos.");
      }
    } catch (err: any) {
      if (sequence !== parseSequence.current) return;
      console.error("[NuevaSolicitudModal] OC parse error", err);
      setOrdenCompraParseMsg("OC cargada. No se pudo leer para autollenado.");
    } finally {
      if (sequence === parseSequence.current) setOrdenCompraParseBusy(false);
    }
  };

  const applyFacturaXmlAutofill = async (file: File) => {
    setOrdenCompraParseBusy(true);
    setOrdenCompraParseMsg("Leyendo XML de factura...");

    setSourceCompanyConfirmed(false);
    const sequence = ++parseSequence.current;
    try {
      const parsed = await parseFacturaXmlFile(file);
      if (sequence !== parseSequence.current) return;
      setFacturaXmlParsed(parsed);

      const matchedClient = matchOptionByLabel(clientOptions, parsed.clienteNombre);
      const matchedCompany = matchOptionByLabel(companyOptions, parsed.proveedorNombre);
      const matchedOperation = findFacturaSubtotalOperation(operationOptions);
      setSourceCompanyWarning(formData.companyId && matchedCompany && formData.companyId !== matchedCompany.value
        ? `Empresa seleccionada: ${formData.companyName}. El documento corresponde a ${matchedCompany.label}; el formulario cambio a la empresa del documento. Verifica antes de crear.` : "");

      const filled: string[] = [matchedClient && "cliente", matchedCompany && "empresa", matchedOperation && "tipo de operacion", parsed.montoSolicitud > 0 && "monto total", parsed.tipoFactura && "tipo factura"].filter(Boolean) as string[];

      setFormData((prev) => {
        const next = {
          ...prev,
          clientId: "",
          clientName: "Selecciona Cliente",
          companyId: "",
          companyName: "Selecciona Empresa",
          operationTypeKey: "",
          operationTypeName: "Selecciona tipo de operacion",
          tipoFactura: "PUE",
          monto: "",
          comentario: "",
        };

        if (matchedClient) {
          next.clientId = matchedClient.value;
          next.clientName = matchedClient.label;
        }

        if (matchedCompany) {
          next.companyId = matchedCompany.value;
          next.companyName = matchedCompany.label;
        }

        if (matchedOperation) {
          next.operationTypeKey = matchedOperation.value;
          next.operationTypeName = matchedOperation.label;
        }

        if (parsed.montoSolicitud > 0) {
          next.monto = parsed.montoSolicitud.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
        }

        if (parsed.tipoFactura === "PUE" || parsed.tipoFactura === "PPD") {
          next.tipoFactura = parsed.tipoFactura;
        }

        const note = [
          parsed.referencia || `XML ${file.name}`,
          parsed.uuid ? `UUID ${parsed.uuid}` : "",
          parsed.subtotal ? `Subtotal XML ${parsed.subtotal}` : "",
          parsed.total ? `Total XML ${parsed.total}` : "",
          "Tipo operacion XML: Factura subtotal",
        ].filter(Boolean).join(" | ");

        if (!String(next.comentario || "").trim()) {
          next.comentario = note;
        }

        return next;
      });

      const missing = [
        parsed.tipoComprobante === "I" ? "" : "XML no es factura de ingreso",
        matchedClient ? "" : "cliente",
        matchedCompany ? "" : "empresa",
        matchedOperation ? "" : "tipo de operacion Factura subtotal",
        parsed.montoSolicitud > 0 ? "" : "total XML",
      ].filter(Boolean);

      if (filled.length > 0) {
        setOrdenCompraParseMsg(
          missing.length > 0
            ? `XML leido. Autollenado: ${filled.join(", ")}. Falta revisar: ${missing.join(", ")}.`
            : `XML leido. Autollenado completo usando TOTAL XML y Factura subtotal.`
        );
      } else {
        setOrdenCompraParseMsg("XML cargado. No pude autollenar campos; corrige el archivo o catalogos.");
      }
    } catch (err: any) {
      if (sequence !== parseSequence.current) return;
      console.error("[NuevaSolicitudModal] XML parse error", err);
      setOrdenCompraParseMsg(err?.message || "XML cargado. No se pudo leer para autollenado.");
    } finally {
      if (sequence === parseSequence.current) setOrdenCompraParseBusy(false);
    }
  };

  const isOrdenCompraFile = (file: File | null) => {
    if (!file) return false;
    const name = String(file.name || "").toLowerCase();
    return name.endsWith(".xlsx") || name.endsWith(".csv");
  };

  const isFacturaXmlFile = (file: File | null) => {
    if (!file) return false;
    const name = String(file.name || "").toLowerCase();
    return name.endsWith(".xml");
  };

  const setSolicitudSourceFromFile = (file: File | null) => {
    if (!file || submission.current || saving.current) return;

    if (!isOrdenCompraFile(file) && !isFacturaXmlFile(file)) {
      alert("El archivo debe ser Orden de Compra Excel o Factura XML.");
      return;
    }

    if (file.size > 1024 * 1024) {
      alert("El archivo no debe exceder 1 MB.");
      return;
    }

    setOrdenCompraUploadPct(0);
    setOrdenCompraParseBusy(false);
    setOrdenCompraParseMsg("");
    setOrdenCompraParsed(null);
    setFacturaXmlParsed(null);

    if (isFacturaXmlFile(file)) {
      setOrdenCompraFile(null);
      setFacturaXmlFile(file);
      void applyFacturaXmlAutofill(file);
      return;
    }

    setFacturaXmlFile(null);
    setOrdenCompraFile(file);
    void applyOrdenCompraAutofill(file);
  };
  const handleSave = async (e: React.FormEvent) => {
    const releaseTiming = beginOperationTiming();
    e.preventDefault();
    if (saving.current) return;
    if (sourceCompanyWarning && !sourceCompanyConfirmed) {
      setSaveError("Confirma o corrige la empresa detectada en el documento antes de crear.");
      return;
    }
    const numMonto = parseFloat(String(formData.monto).replace(/,/g, ""));

    if (!isSolicitudFormComplete) {
      return;
    }

    const sourceFile = facturaXmlFile || ordenCompraFile;
    const sourceDocumentType: "FACTURA_XML" | "ORDEN_COMPRA" = facturaXmlFile ? "FACTURA_XML" : "ORDEN_COMPRA";
    const parsedSource = facturaXmlFile ? facturaXmlParsed : ordenCompraParsed;

    if (!sourceFile) {
      return alert("La orden de compra o XML de factura es obligatorio.");
    }

    if (!parsedSource || Number(parsedSource.montoSolicitud || 0) <= 0) {
      return alert("El archivo fuente no tiene Total valido. Corrige la OC/XML antes de crear la solicitud.");
    }

    const parsedMonto = Number(parsedSource.montoSolicitud || 0);
    if (Math.round(numMonto * 100) !== Math.round(parsedMonto * 100)) {
      return alert("El monto de la solicitud no coincide con el Total del archivo fuente. Vuelve a cargar la OC/XML.");
    }

    if (parsedSource.tipoFactura && formData.tipoFactura !== parsedSource.tipoFactura) {
      return alert("El tipo de factura no coincide con el archivo fuente. Vuelve a cargar la OC/XML.");
    }

    if (facturaXmlFile && !isFacturaXmlValidForSolicitud) {
      return alert("El XML debe ser una factura de ingreso valida con Total.");
    }

    if (!selectedCompany?.despachoId) {
      return alert("La empresa seleccionada no tiene despacho asignado. Corrige la empresa antes de crear la solicitud.");
    }

    saving.current = true;
    setIsSubmitting(true);
    setSaveError("");
    try {
      const createResult: any = submission.current || await createSolicitud({
        clienteId: formData.clientId,
        companyId: formData.companyId,
        despachoId: String(selectedCompany?.despachoId || "").trim(),
        operationTypeKey: String(formData.operationTypeKey || "").trim(),
        monto: numMonto,
        tipoFactura: formData.tipoFactura,
        comentario: formData.comentario,
        clienteNombre: formData.clientName,
        empresaNombre: formData.companyName,
      });

      const solicitudId = String(createResult?.solicitudId || "").trim();
      const folio = String(createResult?.folio || "").trim();
      if (!solicitudId || !folio) {
        throw new Error("createSolicitud no devolvio solicitudId/folio canonicos.");
      }
      // Keep the persisted identity and File until the source is finalized.
      // A failed upload retries this same operation, never createSolicitud again.
      submission.current = { solicitudId, folio };
      window.dispatchEvent(new CustomEvent("PAY0_SOLICITUD_CREATED_LOCAL", {
        detail: { solicitudId, folio },
      }));
      await uploadSolicitudDoc({
        solicitudId, documentType: sourceDocumentType, file: sourceFile,
        onProgress: setOrdenCompraUploadPct,
      });
      // Finalize enqueues IQ; this does not wait for the IQ worker/HTTP response.
      onClose();
      releaseTiming(solicitudId);

      resetForm();
      return;
    } catch (err: any) {
      setSaveError(`${submission.current ? `Solicitud ${submission.current.folio} guardada; archivo pendiente. ` : ""}${err.message || "No se pudo guardar."}`);
    } finally {
      saving.current = false;
      setIsSubmitting(false);
    }
  };

  const solicitudMontoNumber = Number(
    String(formData.monto || "").replace(/,/g, "").trim()
  );
  const isFacturaXmlValidForSolicitud =
    !facturaXmlFile ||
    (facturaXmlParsed?.tipoComprobante === "I" && Number(facturaXmlParsed?.montoSolicitud || 0) > 0);

  const sourceParsedForSolicitud = facturaXmlFile ? facturaXmlParsed : ordenCompraParsed;

  const isSolicitudFormComplete =
    Boolean(sourceParsedForSolicitud) &&
    Number(sourceParsedForSolicitud?.montoSolicitud || 0) > 0 &&
    Boolean(formData.clientId) &&
    Boolean(formData.companyId) &&
    Boolean(formData.operationTypeKey) &&
    Boolean(formData.tipoFactura) &&
    Boolean(ordenCompraFile || facturaXmlFile) &&
    !ordenCompraParseBusy &&
    isFacturaXmlValidForSolicitud &&
    Number.isFinite(solicitudMontoNumber) &&
    solicitudMontoNumber > 0;
  const closeModal = () => {
    if (isSubmitting || submission.current) return;
    resetForm();
    onClose();
  };
  if (!open || !canCreateSolicitud) return null;

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeModal();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          closeModal();
        }
      }}
      tabIndex={-1}
    >
      <div className={variant === "mat" ? "relative max-h-[calc(100dvh-2rem)] w-full max-w-[520px] overflow-y-auto rounded-3xl border border-white/10 bg-[#161d2b] p-5 shadow-2xl" : "relative w-[calc(100vw-2rem)] max-w-[520px] overflow-visible rounded-3xl border border-white/10 bg-[#161d2b] p-6 shadow-2xl"}>
          {variant === "mat" ? <h2 className="mb-4 text-lg font-black text-white">Nueva solicitud</h2> : null}
          <button
            type="button"
            className={variant === "mat" ? "absolute right-4 top-4 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400" : "absolute -right-2 -top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-[#0b1220] text-slate-400 shadow-lg shadow-black/40 transition hover:bg-white/5 hover:text-white disabled:opacity-50"}
            aria-label="Cerrar"
            title="Cerrar"
            onClick={closeModal}

          >
            <X size={16} />
          </button>
<form onSubmit={handleSave} className="relative grid grid-cols-1 gap-3 text-[13px] text-slate-300">
                    <UiSelect
            menuMode={variant === "mat" ? "inline" : "absolute"}
            value={formData.clientId}
            onChange={(value) => {
              if (sourceDocumentLock) return;

              const client = clientes.find((c) => String(c.id || "") === String(value || ""));
              setFormData({
                ...formData,
                clientId: value,
                clientName: client?.name || "Selecciona Cliente",
              });
            }}
            options={clientOptions}
            disabled={sourceDocumentLock}
            placeholder="Selecciona Cliente"
          />

          <UiSelect
            menuMode={variant === "mat" ? "inline" : "absolute"}
            value={formData.companyId}
            onChange={(value) => {
              if (sourceDocumentLock) return;

              const company = empresas.find((e) => String(e.id || "") === String(value || ""));
              setSourceCompanyConfirmed(false);
              setFormData({
                ...formData,
                companyId: value,
                companyName: company?.name || company?.nombre || "Selecciona Empresa",
              });
            }}
            options={companyOptions}
            disabled={sourceDocumentLock}
            placeholder="Selecciona Empresa"
          />

          <UiSelect
            menuMode={variant === "mat" ? "inline" : "absolute"}
            value={formData.operationTypeKey}
            onChange={(value) => {
              if (sourceDocumentLock) return;

              const operation = operationTypes.find(
                (op: any) => String(op.key || op.id || "") === String(value || "")
              );
              setFormData({
                ...formData,
                operationTypeKey: value,
                operationTypeName: String(
                  operation?.name || operation?.label || operation?.key || "Operacion"
                ),
              });
            }}
            options={operationOptions}
            disabled={sourceDocumentLock}
            placeholder="Selecciona tipo de operacion"
          />

          <UiSelect
            menuMode={variant === "mat" ? "inline" : "absolute"}
            value={formData.tipoFactura}
            onChange={(value) => {
              if (sourceDocumentLock) return;
              setFormData({ ...formData, tipoFactura: value });
            }}
            options={tipoFacturaOptions}
            disabled={sourceDocumentLock}
            placeholder="Selecciona tipo de factura"
          />
<div className="relative group">
            <span className="absolute left-3 top-3 text-slate-500 group-hover:text-sky-400">$</span>
            <input
              required
              type="text"
              value={formData.monto}
              onChange={handleMontoChange}
              onBlur={handleMontoBlur}
              readOnly={sourceDocumentLock}
              disabled={sourceDocumentLock}
              placeholder="0.00"
              className="h-10 w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 pl-7 text-[14px] font-mono text-slate-300 outline-none transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-70"
            />
          </div>

          <div
            className={`rounded-xl border border-dashed px-3 py-3 transition ${
              ordenCompraDragging
                ? "border-[#0063C4]/60 bg-[#0063C4]/10"
                : ordenCompraFile
                  ? "border-emerald-400/30 bg-emerald-500/10"
                  : "border-white/10 bg-[#0b1220]"
            }`}
            onDragEnter={(e) => {
              e.preventDefault();
              if (!isSubmitting) setOrdenCompraDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!isSubmitting) setOrdenCompraDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setOrdenCompraDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setOrdenCompraDragging(false);
              if (isSubmitting) return;
              setSolicitudSourceFromFile(e.dataTransfer.files?.[0] || null);
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[12px] text-slate-200">Orden de Compra o Factura XML *</div>
                <div className="text-[11px] text-slate-500">Excel .xlsx, .csv o XML - max 1 MB</div>
              </div>
              <UploadCloud size={18} className="text-sky-300" />
            </div>

            <label className="flex cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-slate-300 transition hover:bg-white/10">
              {facturaXmlFile?.name || ordenCompraFile?.name || "Seleccionar o soltar archivo"}
              <input
                type="file"
                className="hidden"
                accept=".xlsx,.csv,.xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/xml,application/xml"
                disabled={isSubmitting || Boolean(submission.current)}
                onChange={(e) => {
                  setSolicitudSourceFromFile(e.target.files?.[0] || null);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            {ordenCompraParseMsg ? (
              <div className={`mt-2 text-[11px] ${ordenCompraParseBusy ? "text-sky-200" : "text-slate-300"}`}>
                {ordenCompraParseMsg}
              </div>
            ) : null}

            {ordenCompraParsed?.total ? (
              <div className="mt-1 text-[11px] text-emerald-300">
                Monto solicitud = Total OC: ${ordenCompraParsed.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            ) : null}

            {facturaXmlParsed?.total ? (
              <div className="mt-1 text-[11px] text-emerald-300">
                Monto solicitud = Total XML: ${facturaXmlParsed.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            ) : null}

            {facturaXmlParsed?.uuid ? (
              <div className="mt-1 text-[11px] text-slate-400">
                UUID: {facturaXmlParsed.uuid}
              </div>
            ) : null}




{ordenCompraUploadPct > 0 && ordenCompraUploadPct < 100 ? (
              <div className="mt-2 text-[11px] text-sky-200">Subiendo archivo {ordenCompraUploadPct}%</div>
            ) : null}
          </div>

          <textarea
            value={formData.comentario}
            onChange={(e) => {
              if (sourceDocumentLock) return;
              setFormData({ ...formData, comentario: e.target.value });
            }}
            readOnly={sourceDocumentLock}
            disabled={sourceDocumentLock}
            placeholder="Comentario opcional"
            className="min-h-[82px] w-full resize-none rounded-xl border border-white/10 bg-[#0b1220] px-4 py-2 text-[13px] text-slate-300 outline-none transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-70"
          />

          {sourceCompanyWarning && <div className="text-sm text-amber-200"><p role="alert">{sourceCompanyWarning}</p><label className="flex gap-2"><input type="checkbox" checked={sourceCompanyConfirmed} disabled={isSubmitting} onChange={e => setSourceCompanyConfirmed(e.target.checked)} />Confirmo que la empresa y el documento corresponden a esta solicitud.</label></div>}
          {saveError && <p role="alert" className="text-sm text-amber-200">{saveError} Conservamos el archivo para reintentar sin crear otra solicitud.</p>}
          <button
            type="submit"
            disabled={isSubmitting || !isSolicitudFormComplete}
            className={
              isSolicitudFormComplete
                ? "w-full rounded-xl border border-[#0063C4]/40 bg-[#0063C4]/25 px-5 py-3 text-[13px] font-normal uppercase text-sky-100 transition hover:bg-[#0063C4]/35 disabled:opacity-50"
                : "w-full rounded-xl border border-amber-400/30 bg-amber-500/20 px-5 py-3 text-[13px] font-normal uppercase text-amber-100 transition hover:bg-amber-500/25 disabled:opacity-50"
            }
            title={isSolicitudFormComplete ? "" : "Campos incompletos o archivo faltante"}
          >
            {isSubmitting ? "Guardando solicitud y archivo..." : ordenCompraParseBusy ? "Leyendo archivo..." : submission.current ? "Reintentar archivo de esta solicitud" : isSolicitudFormComplete ? "Crear solicitud" : "Campos incompletos"}
          </button>
        </form>
      </div>
    </div>
  );
}
