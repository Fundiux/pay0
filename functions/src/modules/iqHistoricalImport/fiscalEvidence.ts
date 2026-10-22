const text=(value:unknown)=>String(value??"").trim();
const upper=(value:unknown)=>text(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
const first=(row:Record<string,unknown>,keys:string[])=>keys.map(key=>text(row[key])).find(Boolean)||"";
const method=(value:unknown):"PUE"|"PPD"|null=>{const normalized=upper(value);return normalized==="PUE"||normalized==="PPD"?normalized:null;};

export type FiscalEvidence={invoiceStatus:"NO_INVOICE"|"INVOICED"|"UNKNOWN";fiscalMethod:"PUE"|"PPD"|null;decision:"EXACT"|"REVIEW_REQUIRED"|"NOT_APPLICABLE";reviewCode:string|null;source:"XML_CFDI"|"IQ"|"NONE";folio:string|null;serie:string|null;uuid:string|null};

export function resolveFiscalEvidence(row:Record<string,unknown>):FiscalEvidence{
  const xmlMethod=method(first(row,["xmlMetodoPago","xml_metodo_pago","cfdiMetodoPago","cfdi_metodo_pago"]));
  const iqRaw=first(row,["facturaMetodoPago","invoice_payment_method","payment_method_cfdi","invoice_type","invoiceType","tipo_factura"]),iqMethod=method(iqRaw);
  const folio=first(row,["facturaFolio","invoice_folio","cfdi_folio"]),serie=first(row,["facturaSerie","invoice_serie","cfdi_serie"]),uuid=upper(first(row,["facturaUuid","uuidCfdi","cfdi_uuid","uuid_cfdi"]));
  const explicitNoInvoice=["NO_INVOICE","SIN_FACTURA","S/F"].includes(upper(first(row,["invoice_status","factura_status","invoiceType","invoice_type"])));
  const hasInvoice=Boolean(xmlMethod||iqMethod||folio||serie||uuid||first(row,["invoice","invoice_id","factura_pdf_url","factura_xml_url"]));
  if(explicitNoInvoice&&!hasInvoice)return{invoiceStatus:"NO_INVOICE",fiscalMethod:null,decision:"NOT_APPLICABLE",reviewCode:null,source:"NONE",folio:null,serie:null,uuid:null};
  if(xmlMethod&&iqMethod&&xmlMethod!==iqMethod)return{invoiceStatus:"INVOICED",fiscalMethod:null,decision:"REVIEW_REQUIRED",reviewCode:"FISCAL_METHOD_CONFLICT",source:"XML_CFDI",folio:folio||null,serie:serie||null,uuid:uuid||null};
  const exact=xmlMethod||iqMethod;
  if(exact)return{invoiceStatus:"INVOICED",fiscalMethod:exact,decision:"EXACT",reviewCode:null,source:xmlMethod?"XML_CFDI":"IQ",folio:folio||null,serie:serie||null,uuid:uuid||null};
  if(hasInvoice||iqRaw)return{invoiceStatus:"INVOICED",fiscalMethod:null,decision:"REVIEW_REQUIRED",reviewCode:"FISCAL_METHOD_REVIEW_REQUIRED",source:"NONE",folio:folio||null,serie:serie||null,uuid:uuid||null};
  return{invoiceStatus:"UNKNOWN",fiscalMethod:null,decision:"REVIEW_REQUIRED",reviewCode:"FISCAL_INVOICE_STATUS_REVIEW_REQUIRED",source:"NONE",folio:null,serie:null,uuid:null};
}
