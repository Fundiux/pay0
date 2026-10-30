const assert = require("node:assert/strict");
const admin = require("firebase-admin");
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Firestore Emulator required");
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
(async () => {
  console.log("IDEMPOTENCY_STAGE=start");
  const { generateCotizacionForSolicitudCore } = await import("../../functions/lib/modules/cotizaciones/callables.js");
  const db = admin.firestore(); const id = `idem-${Date.now()}`, uid = `u-${id}`, rootId = `r-${id}`, clientId = `c-${id}`, companyId = `co-${id}`;
  await Promise.all([
    db.doc(`users/${uid}`).set({ rootId, role:"superadmin", active:true, modules:{solicitudes:{uploadDocs:true}} }),
    db.doc(`clients/${clientId}`).set({ rootId, active:true, rfc:"XAXX010101000", razonSocial:"CLIENTE QA" }), db.doc(`companies/${companyId}`).set({ rootId, active:true, rfc:"TRO230717L64", nombre:"TROSTRE", isOwnCompany:true }),
    db.doc(`solicitudes/${id}`).set({ rootId, clienteId:clientId, companyId, monto:100, iqFolio:`IQ-${id}`, ocFiscalMetadataUploadId:"oc", ocItems:[], folio:id }),
    db.doc("uploads/oc").set({ rootId, solicitudId:id, documentType:"ORDEN_COMPRA", active:true })
  ]);
  try { await generateCotizacionForSolicitudCore({ auth:{uid}, data:{solicitudId:id, replaceExisting:true} }); assert.fail("invalid OC accepted"); }
  catch (e) { assert.equal(e.code,"failed-precondition"); }
  console.log("IDEMPOTENCY_STAGE=invalid_blocked");
  await db.doc(`solicitudes/${id}`).update({ ocItems:[{description:"Servicio QA",unit:"E48",productCode:"72141702",quantity:1}] });
  const first = await generateCotizacionForSolicitudCore({ auth:{uid}, data:{solicitudId:id} });
  const second = await generateCotizacionForSolicitudCore({ auth:{uid}, data:{solicitudId:id} });
  assert.equal(second.alreadyExists,true); assert.equal(second.uploadId,first.uploadId);
  const q = await db.collection("uploads").where("solicitudId","==",id).where("documentType","==","COTIZACION").get(); assert.equal(q.size,1);
  console.log("IDEMPOTENCY_STAGE=single_canonical"); console.log(JSON.stringify({result:"PASS",id,uploadId:first.uploadId}));
})().catch(e=>{console.error(e);process.exitCode=1});
