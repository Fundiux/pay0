import { IQ_CANONICAL_TIME_ZONE, parseIqDateTimeMs } from "../iq/iqDateTime";
import type { P4EntityType } from "./domain";

export type P4HistoricalTime = { availability:"EXACT"|"NOT_AVAILABLE"|"REVIEW_REQUIRED"; required:boolean; sourceField:string|null; rawValue:string|null; sourceTimezone:string|null; normalizedAt:string|null; normalizedDate:string|null; semanticType:"CLIENT_CREATED"|"INVOICE_CREATED"|"PAYMENT_EFFECTIVE"|"APPLICATION_APPLIED"; confidence:"EXACT"|"NORMALIZED_WITH_KNOWN_TIMEZONE"|"DATE_ONLY"|"REVIEW_REQUIRED"|"NOT_AVAILABLE" };
const text=(value:unknown)=>String(value??"").trim();
const semantic=(type:P4EntityType):P4HistoricalTime["semanticType"]=>({CLIENT:"CLIENT_CREATED",SOLICITUD:"INVOICE_CREATED",PAYMENT:"PAYMENT_EFFECTIVE",APPLICATION:"APPLICATION_APPLIED"})[type] as P4HistoricalTime["semanticType"];

export function normalizeIqHistoricalDate(type:P4EntityType,raw:Record<string,unknown>):P4HistoricalTime{
  const required=type!=="CLIENT",fields=["created_at","createdAt","date","fecha","fecha_creacion","fechaCreacion"],sourceField=fields.find(field=>text(raw[field]))||null,rawValue=sourceField?text(raw[sourceField]):null;
  if(!rawValue)return{availability:required?"REVIEW_REQUIRED":"NOT_AVAILABLE",required,sourceField:null,rawValue:null,sourceTimezone:null,normalizedAt:null,normalizedDate:null,semanticType:semantic(type),confidence:required?"REVIEW_REQUIRED":"NOT_AVAILABLE"};
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(rawValue),explicit=/(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawValue),millis=parseIqDateTimeMs(rawValue,IQ_CANONICAL_TIME_ZONE);
  if(millis===null)return{availability:"REVIEW_REQUIRED",required,sourceField,rawValue,sourceTimezone:explicit?"EXPLICIT_OFFSET":IQ_CANONICAL_TIME_ZONE,normalizedAt:null,normalizedDate:null,semanticType:semantic(type),confidence:"REVIEW_REQUIRED"};
  const normalizedDate=dateOnly?rawValue:new Intl.DateTimeFormat("en-CA",{timeZone:IQ_CANONICAL_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(millis));
  return{availability:"EXACT",required,sourceField,rawValue,sourceTimezone:explicit?"EXPLICIT_OFFSET":IQ_CANONICAL_TIME_ZONE,normalizedAt:new Date(millis).toISOString(),normalizedDate,semanticType:semantic(type),confidence:dateOnly?"DATE_ONLY":explicit?"EXACT":"NORMALIZED_WITH_KNOWN_TIMEZONE"};
}

export function temporalAfter(type:P4EntityType,time:P4HistoricalTime):Record<string,unknown>{
  if(time.availability!=="EXACT"||!time.normalizedAt)return{};
  if(type==="CLIENT"||type==="SOLICITUD")return{createdAt:time.normalizedAt};
  if(type==="PAYMENT")return{createdAt:time.normalizedAt,fechaPago:time.normalizedAt,reportDateAt:time.normalizedAt};
  return{createdAt:time.normalizedAt,appliedAt:time.normalizedAt};
}

export const P4_TEMPORAL_TIMESTAMP_FIELDS=new Set(["createdAt","fechaPago","reportDateAt","appliedAt","historicalEventAt"]);
