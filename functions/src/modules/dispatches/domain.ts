export const DISPATCH_AUTOMATION_MODES = ["UNCONFIGURED", "ERP", "COMMUNICATION"] as const;
export type DispatchAutomationMode = typeof DISPATCH_AUTOMATION_MODES[number];
export const DISPATCH_ERP_PROVIDERS = ["IQ"] as const;
export type DispatchErpProvider = typeof DISPATCH_ERP_PROVIDERS[number];
export const DISPATCH_DELIVERY_CHANNELS = ["WHATSAPP", "EMAIL"] as const;
export type DispatchDeliveryChannel = typeof DISPATCH_DELIVERY_CHANNELS[number];

export type CanonicalDispatchAutomation = {
  automationMode: DispatchAutomationMode;
  erpProvider: DispatchErpProvider | null;
  deliveryChannels: DispatchDeliveryChannel[];
};

function clean(value: unknown): string { return String(value ?? "").trim().toUpperCase(); }
export function normalizeDispatchDeliveryChannels(value: unknown): DispatchDeliveryChannel[] {
  const input=Array.isArray(value)?value:value==null||value===""?[]:[value],result:DispatchDeliveryChannel[]=[];
  for(const item of input){const raw=clean(item),channel=raw==="CORREO"?"EMAIL":raw==="WA"?"WHATSAPP":raw;if((channel==="WHATSAPP"||channel==="EMAIL")&&!result.includes(channel))result.push(channel)}
  return result;
}
export function normalizeDispatchErpProvider(value: unknown): DispatchErpProvider | null {
  const normalized=clean(value);return normalized==="IQ"||normalized==="IQ_ERP"?"IQ":null;
}
export function normalizeDispatchAutomationMode(value: unknown): DispatchAutomationMode {
  const normalized=clean(value);if(normalized==="ERP")return "ERP";if(normalized==="COMMUNICATION"||normalized==="COMUNICACION")return "COMMUNICATION";return "UNCONFIGURED";
}
export function getCanonicalDispatchAutomation(input: any): CanonicalDispatchAutomation {
  const channels=normalizeDispatchDeliveryChannels(input?.deliveryChannels);
  const legacyIq=clean(input?.integrationProvider)==="IQ"||clean(input?.integrationProvider)==="IQ_ERP";
  const explicitMode=clean(input?.automationMode);
  const mode=explicitMode?normalizeDispatchAutomationMode(explicitMode):legacyIq?"ERP":channels.length?"COMMUNICATION":"UNCONFIGURED";
  if(mode==="ERP")return {automationMode:"ERP",erpProvider:normalizeDispatchErpProvider(input?.erpProvider)||legacyIq&&"IQ"||null,deliveryChannels:channels};
  if(mode==="COMMUNICATION")return {automationMode:"COMMUNICATION",erpProvider:null,deliveryChannels:channels};
  return {automationMode:"UNCONFIGURED",erpProvider:null,deliveryChannels:[]};
}
export function assertValidDispatchAutomation(input: any): CanonicalDispatchAutomation {
  const value=getCanonicalDispatchAutomation(input);
  if(value.automationMode==="ERP"&&!value.erpProvider)throw new Error("ERP_PROVIDER_REQUIRED");
  if(value.automationMode==="COMMUNICATION"&&value.deliveryChannels.length===0)throw new Error("DELIVERY_CHANNEL_REQUIRED");
  return value;
}
export function isIqDispatch(input: any): boolean {const x=getCanonicalDispatchAutomation(input);return x.automationMode==="ERP"&&x.erpProvider==="IQ"}
export function canRunIqAutomationForDispatch(input: any): boolean {return input?.active!==false&&isIqDispatch(input)}
export function canRunCommunicationAutomationForDispatch(input: any): boolean {const x=getCanonicalDispatchAutomation(input);return input?.active!==false&&x.automationMode==="COMMUNICATION"&&x.deliveryChannels.length>0}
export function buildDispatchAutomationPatch(input:{automationMode?:unknown;erpProvider?:unknown;deliveryChannels?:unknown;integrationProvider?:unknown;existing?:any}):CanonicalDispatchAutomation {
  const existing=getCanonicalDispatchAutomation(input.existing||{}),hasMode=input.automationMode!==undefined,hasErp=input.erpProvider!==undefined,hasChannels=input.deliveryChannels!==undefined,hasLegacy=input.integrationProvider!==undefined;
  return assertValidDispatchAutomation({automationMode:hasMode?input.automationMode:hasLegacy?clean(input.integrationProvider)==="IQ"?"ERP":"UNCONFIGURED":existing.automationMode,erpProvider:hasErp?input.erpProvider:hasLegacy?input.integrationProvider:existing.erpProvider,deliveryChannels:hasChannels?input.deliveryChannels:existing.deliveryChannels,integrationProvider:input.integrationProvider});
}
// Compatibilidad temporal de codigo A2; no usar para nuevas decisiones.
export const DISPATCH_INTEGRATION_PROVIDERS=["NONE","IQ"] as const;
export function normalizeDispatchIntegrationProvider(value:unknown):"NONE"|"IQ"{return normalizeDispatchErpProvider(value)==="IQ"?"IQ":"NONE"}
export const buildDispatchIntegrationPatch=buildDispatchAutomationPatch;
