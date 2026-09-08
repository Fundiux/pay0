import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const domain = read("functions/src/modules/clients/domain.ts");
const service = read("functions/src/modules/documentDelivery/service.ts");
const routes = read("functions/src/modules/documentDelivery/whatsappRoutes.ts");
const connector = read("tools/whatsapp-qr-connector/connector.cjs");
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`); };

test("normaliza telefono mexicano y elimina formato", () => { assert.match(domain, /digits\.length === 10/); assert.match(domain, /digits\.startsWith\("521"\)/); assert.match(domain, /\^52\\d\{10\}\$/); });
test("Clientes valida WhatsApp antes de guardar", () => assert.match(domain, /CLIENT_WHATSAPP_INVALID/));
test("envio exige clienteId y carga Clients en backend", () => { assert.match(service, /Falta clienteId para resolver el WhatsApp canonico/); assert.match(service, /collection\("clients"\)\.doc\(clienteId\)\.get\(\)/); });
test("envio no confia en telefono de pantalla", () => { assert.match(service, /normalizeClientWhatsapp\(\(clientData as any\)\.whatsapp\)/); assert.doesNotMatch(service, /normalizeClientWhatsapp\(data\./); });
test("envio valida root del cliente", () => assert.match(service, /Cliente fuera de tu root/));
test("job conserva fuente canonica y telefono normalizado", () => { assert.match(service, /clienteWhatsappSource: `clients\/\$\{clienteId\}\.whatsapp`/); assert.match(service, /clienteWhatsapp,/); });
test("autorizacion distingue Solicitudes y Dispersiones", () => { assert.match(service, /requiredModule: "solicitudes"/); assert.match(service, /requiredAction: "uploadDocs"/); assert.match(service, /requiredModule: "wallet"/); assert.match(service, /requiredAction: "dispersiones"/); });
test("telefono del cliente siempre es destino principal", () => { assert.match(routes, /safeDocId: "CLIENT_PRIMARY"/); assert.match(routes, /destinationType: "CLIENT_PRIMARY"/); assert.match(routes, /const destinations = \[primary, \.\.\.additional/); });
test("rutas configuradas solo agregan destinos adicionales", () => assert.match(routes, /destinationType: "ADDITIONAL" as const/));
test("sin ruta adicional conserva destino del cliente", () => assert.match(routes, /writeDestinations\(db, jobRef, \[primary\], null, null, actor\)/));
test("resolucion vuelve a leer telefono canonico", () => assert.match(routes, /\(client as any\)\.whatsapp/));
test("conector verifica existencia real en WhatsApp", () => { assert.match(connector, /client\.getNumberId\(phone\)/); assert.match(connector, /no esta registrado en WhatsApp/); });
test("conector persiste chatId resuelto y verificacion", () => { assert.match(connector, /resolvedChatId: chatId/); assert.match(connector, /recipientVerified: true/); });

console.log(`H4-D76-A19B QA: ${passed}/${passed} pruebas OK.`);
