// H4_D85_A10_A45_CLIENT_CSF_FRONTEND
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebaseClient";

export type ParsedClientCsf = {
  rfc:string;
  razonSocial:string;
  regimenCapital:string;
  nombreComercial:string;
  fechaInicioOperaciones:string;
  estatusPadron:string;
  codigoPostal:string;
  tipoVialidad:string;
  calle:string;
  numeroExterior:string;
  numeroInterior:string;
  colonia:string;
  localidad:string;
  municipio:string;
  estado:string;
  entreCalle:string;
  yCalle:string;
  regimenFiscal:string;
  lugarEmision:string;
  fechaEmision:string;
  documentDate:string;
  periodYear:number|null;
  periodMonth:number|null;
  rawTextSample:string;
};

export type ClientCsfIntakeResult = {
  ok:boolean;
  intakeId:string;
  sha256:string;
  parsed:ParsedClientCsf;
};

async function fileToBase64(file:File):Promise<string>{
  const buffer=await file.arrayBuffer();
  const bytes=new Uint8Array(buffer);
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary += String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
  }
  return btoa(binary);
}

export async function parseClientCsfFile(file:File):Promise<ClientCsfIntakeResult>{
  if(!file) throw new Error("Selecciona una Constancia de Situacion Fiscal.");
  if(file.type && file.type !== "application/pdf") throw new Error("La CSF debe ser PDF.");
  if(file.size > 10*1024*1024) throw new Error("La CSF excede 10 MB.");

  const callable=httpsCallable(functions,"parseClientCsfCallable");
  const result:any=await callable({
    fileName:file.name,
    fileBase64:await fileToBase64(file),
  });
  return result.data as ClientCsfIntakeResult;
}

export async function finalizeClientCsfIntake(input:{
  intakeId:string;
  clientId:string;
  entityDocumentId:string;
}){
  const callable=httpsCallable(functions,"finalizeClientCsfIntakeCallable");
  const result:any=await callable(input);
  return result.data;
}
