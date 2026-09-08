// H4_D85_A10_A45_CSF_CANONICAL
import { createHash } from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../sharedCallables/helpers";
import { attachClientKycCsfDocument } from "../clientKyc/service";

const pdfParse = require("pdf-parse");

export type ClientCsfParsed = {
  rfc: string;
  razonSocial: string;
  regimenCapital: string;
  nombreComercial: string;
  fechaInicioOperaciones: string;
  estatusPadron: string;
  codigoPostal: string;
  tipoVialidad: string;
  calle: string;
  numeroExterior: string;
  numeroInterior: string;
  colonia: string;
  localidad: string;
  municipio: string;
  estado: string;
  entreCalle: string;
  yCalle: string;
  regimenFiscal: string;
  lugarEmision: string;
  fechaEmision: string;
  documentDate: string;
  periodYear: number | null;
  periodMonth: number | null;
  rawTextSample: string;
};

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/[\t\r]+/g," ")
    .replace(/ {2,}/g," ")
    .trim();
}

function normalizeLines(text: string): string {
  return String(text || "")
    .replace(/\r/g,"")
    .replace(/[\t]+/g," ")
    .split("\n")
    .map(line=>clean(line))
    .filter(Boolean)
    .join("\n");
}

function pick(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  return clean(match?.[1] || "");
}

function normalizeSatAscii(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function satAsciiField(
  source: string,
  label: RegExp,
  nextLabels: RegExp[] = [],
): string {
  const flat = normalizeSatAscii(source);
  const labelMatch = flat.match(label);
  if (!labelMatch || labelMatch.index == null) return "";

  const start = labelMatch.index + labelMatch[0].length;
  const tail = flat.slice(start);

  let end = tail.length;

  for (const nextLabel of nextLabels) {
    const next = tail.match(nextLabel);
    if (next?.index != null && next.index < end) {
      end = next.index;
    }
  }

  return clean(tail.slice(0, end));
}

function satAsciiRfc(source: string): string {
  const flat = normalizeSatAscii(source);

  const labeled = satAsciiField(
    flat,
    /\bRFC\s*:\s*/i,
    [
      /DENOMINACION\s*\/\s*RAZON\s*SOCIAL\s*:\s*/i,
      /REGIMEN\s*CAPITAL\s*:\s*/i,
    ],
  );

  const labeledMatch = labeled.match(
    /\b([A-Z&]{3,4}\d{6}[A-Z0-9]{3})\b/i,
  );

  if (labeledMatch?.[1]) {
    return labeledMatch[1].toUpperCase();
  }

  const anyMatch = flat.match(
    /\b([A-Z&]{3,4}\d{6}[A-Z0-9]{3})\b/i,
  );

  return clean(anyMatch?.[1] || "").toUpperCase();
}

function monthNumber(name: string): number | null {
  const map: Record<string,number> = {
    ENERO:1,FEBRERO:2,MARZO:3,ABRIL:4,MAYO:5,JUNIO:6,
    JULIO:7,AGOSTO:8,SEPTIEMBRE:9,OCTUBRE:10,NOVIEMBRE:11,DICIEMBRE:12,
  };
  return map[clean(name).toUpperCase()] || null;
}

function parseSatDate(raw: string) {
  const m = clean(raw).toUpperCase().match(/(\d{1,2})\s+DE\s+([A-ZÃÃ‰ÃÃ“ÃšÃ‘]+)\s+DE\s+(\d{4})/);
  if(!m) return {iso:"",year:null,month:null};
  const month = monthNumber(m[2]);
  if(!month) return {iso:"",year:null,month:null};
  const day = String(Number(m[1])).padStart(2,"0");
  return {
    iso:`${m[3]}-${String(month).padStart(2,"0")}-${day}`,
    year:Number(m[3]),
    month,
  };
}

function findRegimenFiscal(text: string): string {
  const section = text.match(/Reg[iÃ­]menes:\s*([\s\S]*?)\s*Obligaciones:/i)?.[1] || "";
  return clean(
    section
      .replace(/R[eÃ©]gimen\s+Fecha Inicio\s+Fecha Fin/gi,"")
      .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g,"")
      .replace(/\n+/g," ")
  );
}

export function parseClientCsfText(rawText: string): ClientCsfParsed {
  const text = normalizeLines(rawText);

  const rfc = satAsciiRfc(text);

  const razonSocial =
    satAsciiField(
      text,
      /DENOMINACION\s*\/\s*RAZON\s*SOCIAL\s*:\s*/i,
      [
        /REGIMEN\s*CAPITAL\s*:\s*/i,
        /NOMBRE\s*COMERCIAL\s*:\s*/i,
      ],
    ) ||
    satAsciiField(
      text,
      /NOMBRE,\s*DENOMINACION\s*O\s*RAZON\s*SOCIAL\s*:?\s*/i,
      [
        /IDCIF\s*:\s*/i,
        /VALIDA\s*TU\s*INFORMACION/i,
      ],
    );

  const regimenCapital = satAsciiField(
    text,
    /REGIMEN\s*CAPITAL\s*:\s*/i,
    [/NOMBRE\s*COMERCIAL\s*:\s*/i],
  );

  const nombreComercial = satAsciiField(
    text,
    /NOMBRE\s*COMERCIAL\s*:\s*/i,
    [/FECHA\s*INICIO\s*DE\s*OPERACIONES\s*:\s*/i],
  );

  const fechaInicioOperaciones = satAsciiField(
    text,
    /FECHA\s*INICIO\s*DE\s*OPERACIONES\s*:\s*/i,
    [/ESTATUS\s*EN\s*EL\s*PADRON\s*:\s*/i],
  );

  const estatusPadron = satAsciiField(
    text,
    /ESTATUS\s*EN\s*EL\s*PADRON\s*:\s*/i,
    [
      /FECHA\s*DE\s*ULTIMO\s*CAMBIO\s*DE\s*ESTADO\s*:\s*/i,
      /DATOS\s*DEL\s*DOMICILIO\s*REGISTRADO/i,
    ],
  );

  const codigoPostal =
    satAsciiField(
      text,
      /CODIGO\s*POSTAL\s*:\s*/i,
      [/TIPO\s*DE\s*VIALIDAD\s*:\s*/i],
    ).match(/\b\d{5}\b/)?.[0] || "";

  const tipoVialidad = satAsciiField(
    text,
    /TIPO\s*DE\s*VIALIDAD\s*:\s*/i,
    [/NOMBRE\s*DE\s*VIALIDAD\s*:\s*/i],
  );

  const calle = satAsciiField(
    text,
    /NOMBRE\s*DE\s*VIALIDAD\s*:\s*/i,
    [/NUMERO\s*EXTERIOR\s*:\s*/i],
  );

  const numeroExterior = satAsciiField(
    text,
    /NUMERO\s*EXTERIOR\s*:\s*/i,
    [
      /NUMERO\s*INTERIOR\s*:\s*/i,
      /NOMBRE\s*DE\s*LA\s*COLONIA\s*:\s*/i,
    ],
  );

  const numeroInterior = satAsciiField(
    text,
    /NUMERO\s*INTERIOR\s*:\s*/i,
    [/NOMBRE\s*DE\s*LA\s*COLONIA\s*:\s*/i],
  );

  const colonia = satAsciiField(
    text,
    /NOMBRE\s*DE\s*LA\s*COLONIA\s*:\s*/i,
    [/NOMBRE\s*DE\s*LA\s*LOCALIDAD\s*:\s*/i],
  );

  const localidad = satAsciiField(
    text,
    /NOMBRE\s*DE\s*LA\s*LOCALIDAD\s*:\s*/i,
    [
      /NOMBRE\s*DEL\s*MUNICIPIO\s*O\s*DEMARCACION\s*TERRITORIAL\s*:\s*/i,
    ],
  );

  const municipio = satAsciiField(
    text,
    /NOMBRE\s*DEL\s*MUNICIPIO\s*O\s*DEMARCACION\s*TERRITORIAL\s*:\s*/i,
    [/NOMBRE\s*DE\s*LA\s*ENTIDAD\s*FEDERATIVA\s*:\s*/i],
  );

  const estado = satAsciiField(
    text,
    /NOMBRE\s*DE\s*LA\s*ENTIDAD\s*FEDERATIVA\s*:\s*/i,
    [/ENTRE\s*CALLE\s*:\s*/i],
  );

  const entreCalle = satAsciiField(
    text,
    /ENTRE\s*CALLE\s*:\s*/i,
    [/Y\s*CALLE\s*:\s*/i],
  );

  const yCalle = satAsciiField(
    text,
    /Y\s*CALLE\s*:\s*/i,
    [/ACTIVIDADES\s*ECONOMICAS\s*:\s*/i],
  );

  const emisionRaw = satAsciiField(
    text,
    /LUGAR\s*Y\s*FECHA\s*DE\s*EMISION\s*/i,
    [
      /DATOS\s*DE\s*IDENTIFICACION\s*DEL\s*CONTRIBUYENTE\s*:\s*/i,
      /\bRFC\s*:\s*/i,
    ],
  );
  const fechaEmisionRaw =
    pick(emisionRaw,/A\s+(.+)$/i) ||
    pick(text,/A\s+(\d{1,2}\s+DE\s+[A-ZÃÃ‰ÃÃ“ÃšÃ‘]+\s+DE\s+\d{4})/i);
  const date = parseSatDate(fechaEmisionRaw);

  if(!rfc || !razonSocial){
    throw new HttpsError(
      "invalid-argument",
      "El PDF no parece una Constancia de Situacion Fiscal valida: no se pudo identificar RFC y razon social."
    );
  }

  return {
    rfc:rfc.toUpperCase(),
    razonSocial,
    regimenCapital,
    nombreComercial,
    fechaInicioOperaciones,
    estatusPadron,
    codigoPostal,
    tipoVialidad,
    calle,
    numeroExterior,
    numeroInterior,
    colonia,
    localidad,
    municipio,
    estado,
    entreCalle,
    yCalle,
    regimenFiscal:findRegimenFiscal(text),
    lugarEmision:emisionRaw,
    fechaEmision:fechaEmisionRaw,
    documentDate:date.iso,
    periodYear:date.year,
    periodMonth:date.month,
    rawTextSample:text.slice(0,4000),
  };
}

export async function parseAndCreateClientCsfIntake(params: {
  fileBase64: string;
  fileName: string;
  uid: string;
  rootId: string;
}) {
  const base64 = clean(params.fileBase64).replace(/^data:application\/pdf;base64,/i,"");
  if(!base64) throw new HttpsError("invalid-argument","PDF CSF requerido.");

  const buffer = Buffer.from(base64,"base64");
  if(buffer.length < 20 || buffer.length > 10*1024*1024){
    throw new HttpsError("invalid-argument","Tamano de PDF CSF invalido.");
  }
  if(buffer.subarray(0,5).toString("ascii") !== "%PDF-"){
    throw new HttpsError("invalid-argument","El archivo no es un PDF valido.");
  }

  const pdf = await pdfParse(buffer);
  const parsed = parseClientCsfText(String(pdf?.text || ""));
  const sha256 = createHash("sha256").update(buffer).digest("hex");

  const ref = db.collection("clientCsfIntakes").doc();
  await ref.set({
    rootId:params.rootId,
    createdBy:params.uid,
    fileName:clean(params.fileName) || "CSF.pdf",
    sha256,
    parsed,
    status:"PARSED",
    createdAt:FieldValue.serverTimestamp(),
    updatedAt:FieldValue.serverTimestamp(),
  });

  return {
    ok:true,
    intakeId:ref.id,
    sha256,
    parsed,
  };
}

export async function getClientCsfIntakeForSave(params: {
  intakeId: string;
  uid: string;
  rootId: string;
}) {
  const intakeId = clean(params.intakeId);
  if(!intakeId) return null;

  const ref = db.doc(`clientCsfIntakes/${intakeId}`);
  const snap = await ref.get();
  if(!snap.exists) throw new HttpsError("not-found","Lectura CSF no encontrada.");

  const row:any = snap.data() || {};
  if(clean(row.rootId) !== params.rootId || clean(row.createdBy) !== params.uid){
    throw new HttpsError("permission-denied","Lectura CSF fuera de la sesion autorizada.");
  }

  const status = clean(row.status);
  if(!["PARSED","CLIENT_CREATED"].includes(status)){
    throw new HttpsError("failed-precondition","Lectura CSF ya consumida o invalida.");
  }

  return {
    ref,
    id:intakeId,
    sha256:clean(row.sha256),
    parsed:row.parsed as ClientCsfParsed,
  };
}

export async function bindClientCsfIntake(params: {
  intakeId: string;
  clientId: string;
}) {
  if(!clean(params.intakeId)) return;
  await db.doc(`clientCsfIntakes/${params.intakeId}`).set({
    clientId:params.clientId,
    status:"CLIENT_CREATED",
    updatedAt:FieldValue.serverTimestamp(),
  },{merge:true});
}

export async function finalizeClientCsfIntake(params: {
  intakeId: string;
  clientId: string;
  entityDocumentId: string;
  uid: string;
  rootId: string;
  actorName: string;
}) {
  const intakeRef = db.doc(`clientCsfIntakes/${clean(params.intakeId)}`);
  const clientRef = db.doc(`clients/${clean(params.clientId)}`);
  const documentRef = db.doc(`entityDocuments/${clean(params.entityDocumentId)}`);

  const [intakeSnap,clientSnap,documentSnap] = await Promise.all([
    intakeRef.get(),clientRef.get(),documentRef.get(),
  ]);

  if(!intakeSnap.exists || !clientSnap.exists || !documentSnap.exists){
    throw new HttpsError("not-found","CSF, cliente o documento no encontrado.");
  }

  const intake:any=intakeSnap.data()||{};
  const client:any=clientSnap.data()||{};
  const document:any=documentSnap.data()||{};

  if(clean(intake.rootId)!==params.rootId || clean(client.rootId)!==params.rootId || clean(document.rootId)!==params.rootId){
    throw new HttpsError("permission-denied","CSF fuera del root autorizado.");
  }

  if(clean(intake.clientId)!==params.clientId){
    throw new HttpsError("failed-precondition","La lectura CSF no corresponde al cliente.");
  }

  if(clean(document.entityType)!=="CLIENTE" || clean(document.entityId)!==params.clientId || clean(document.documentType)!=="CONSTANCIA_SITUACION_FISCAL"){
    throw new HttpsError("failed-precondition","El documento no corresponde a la CSF del cliente.");
  }

  if(document.active!==true || clean(document.uploadStatus)!=="FINALIZED"){
    throw new HttpsError("failed-precondition","La CSF aun no esta finalizada en Storage.");
  }

  if(clean(intake.sha256) && clean(document.sha256) && clean(intake.sha256)!==clean(document.sha256)){
    throw new HttpsError("failed-precondition","La CSF subida no coincide con el PDF analizado.");
  }

  const parsed:ClientCsfParsed = intake.parsed || {} as any;

  await documentRef.set({
    validationStatus:"VALIDADO",
    validationKind:"CONSTANCIA_SITUACION_FISCAL",
    validationSource:"BACKEND_PARSE",
    validationErrors:[],
    extractedData:{
      rfc:clean(parsed.rfc),
      razonSocial:clean(parsed.razonSocial),
      regimenFiscal:clean(parsed.regimenFiscal),
      documentDate:clean(parsed.documentDate),
      clientName:clean(parsed.razonSocial),
      opinionStatus:"NO_APLICA",
      rawTextSample:clean(parsed.rawTextSample).slice(0,4000),
    },
    documentDate:clean(parsed.documentDate) || null,
    updatedAt:FieldValue.serverTimestamp(),
  },{merge:true});

  await clientRef.set({
    fiscalProfile:{
      ...(parsed || {}),
      source:"CSF",
      csfIntakeId:params.intakeId,
      sourceDocumentId:params.entityDocumentId,
      sha256:clean(intake.sha256),
      updatedAt:FieldValue.serverTimestamp(),
    },
    updatedAt:FieldValue.serverTimestamp(),
  },{merge:true});

  await attachClientKycCsfDocument({
    clientId:params.clientId,
    rootId:params.rootId,
    entityDocumentId:params.entityDocumentId,
    intakeId:params.intakeId,
    actorUid:params.uid,
    actorName:params.actorName,
  });

  await intakeRef.set({
    entityDocumentId:params.entityDocumentId,
    status:"FINALIZED",
    finalizedAt:FieldValue.serverTimestamp(),
    updatedAt:FieldValue.serverTimestamp(),
  },{merge:true});

  return {
    ok:true,
    clientId:params.clientId,
    intakeId:params.intakeId,
    entityDocumentId:params.entityDocumentId,
    kycStatus:"RFC_RECEIVED",
  };
}
