// Full localhost route: real Auth, callable transport, Firestore and Storage emulators.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const { PDFDocument, StandardFonts } = require('../../functions/node_modules/pdf-lib');
const fixture = JSON.parse(fs.readFileSync(process.env.PAY0_RECEIPT_UI_FIXTURE || 'output/receipt-ui-emulator/fixture.json'));
assert.equal(fixture.projectId, 'demo-pay0-receipt-ui');
process.env.GCLOUD_PROJECT = fixture.projectId;
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
const admin = require('../../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: fixture.projectId });
const db = admin.firestore();
const base = process.env.PAY0_RECEIPT_UI_URL || 'http://127.0.0.1:3105';
assert.equal(new URL(base).hostname, '127.0.0.1');
const output = path.resolve('output/receipt-inline-route');
fs.mkdirSync(output, { recursive: true });

async function main() {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  const date = new Date().toISOString().slice(0, 10), reference = `QA-${Date.now()}`;
  const lines = ['Transferencia SPEI MXN', 'Estado: Aplicada', 'Ordenante: Cliente Prueba', 'RFC ordenante: ABC010101AB1',
    'Beneficiario: Empresa Prueba', 'RFC beneficiario: DEF020202CD2', 'Monto: $1,000.50', `Fecha: ${date}`,
    `Referencia: ${reference}`, 'Concepto: Verificacion sintetica local'];
  const sheet = pdf.addPage();
  lines.forEach((line, index) => sheet.drawText(line, { x: 50, y: 780 - index * 25, size: 14, font }));
  const bytes = await pdf.save();
  const before = await db.collection('pagos').where('rootId', '==', fixture.rootId).get();
  const browser = await chromium.launch({ headless: true });
  let created = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/login`); console.log('E2E_LOGIN_PAGE');
    await page.getByLabel('Usuario o correo electrónico').fill(fixture.email);
    await page.locator('input[type=password]').fill(fixture.password);
    await page.getByRole('button', { name: 'Entrar al sistema' }).click(); console.log('E2E_LOGIN_SUBMITTED');
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 60000 });
    console.log('E2E_AUTHENTICATED'); await page.goto(`${base}/pagos`);
    await expect(page.getByPlaceholder('Buscar por pago o cliente...')).toBeVisible({ timeout: 60000 });
    const transfer = await page.evaluateHandle(({ bytes }) => {
      const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(bytes)], 'comprobante-sintetico.pdf', { type: 'application/pdf' })); return data;
    }, { bytes: Array.from(bytes) });
    const parseResponse = page.waitForResponse(response => response.url().endsWith('/parsePagoReceiptPdf') && response.request().method() === 'POST');
    await page.dispatchEvent('body', 'drop', { dataTransfer: transfer });
    assert.equal((await parseResponse).status(), 200); console.log('E2E_PARSED');
    const dialog = page.getByRole('dialog', { name: 'Revisión de comprobantes' });
    await expect(dialog.getByRole('region', { name: 'Resultado de lectura del comprobante' })).toBeVisible({ timeout: 60000 });
    await expect(dialog.getByText('Cliente Prueba', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText('Empresa Prueba', { exact: true }).first()).toBeVisible();
    await expect(dialog.getByLabel('Seleccionar cliente', { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel('Seleccionar empresa', { exact: true })).toHaveCount(0);
    assert.equal((await db.collection('pagos').where('rootId', '==', fixture.rootId).get()).size, before.size, 'Reading must not create a payment');
    await expect(dialog.locator('details')).not.toHaveAttribute('open', '');
    await dialog.getByRole('button', { name: 'Corregir Importe', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Confirmar y registrar', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Importe', exact: true }).fill('1123.75');
    const correctionResponse = page.waitForResponse(response => response.url().endsWith('/correctPagoReceiptSemanticField') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
    assert.equal((await correctionResponse).status(), 200); console.log('E2E_CORRECTED');
    await expect(dialog.getByText('1,123.75', { exact: true })).toBeVisible();
    await dialog.locator('summary').click();
    await expect(dialog.getByLabel('Historial de correcciones')).toContainText(fixture.uid);
    await expect(dialog.getByLabel('Historial de correcciones')).toContainText('1000.5');
    await dialog.locator('summary').click();
    const operation = await db.doc(`operationTypes/${fixture.operationTypeKey}`).get();
    await dialog.getByRole('button', { name: 'Selecciona tipo de operacion...', exact: true }).click();
    const revalidation = page.waitForResponse(response => response.url().endsWith('/parsePagoReceiptPdf') && response.request().method() === 'POST');
    await page.getByRole('option', { name: operation.get('name'), exact: true }).click();
    assert.equal((await revalidation).status(), 200); console.log('E2E_REVALIDATED');
    await expect(dialog.getByRole('button', { name: 'Confirmar y registrar', exact: true })).toBeEnabled({ timeout: 60000 });
    assert.equal((await db.collection('pagos').where('rootId', '==', fixture.rootId).get()).size, before.size, 'Revalidation must not create a payment');
    await page.screenshot({ path: path.join(output, 'before-confirmation.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Confirmar y registrar', exact: true }).click();
    await expect(dialog.getByText('Pago creado', { exact: true })).toBeVisible({ timeout: 60000 });
    const after = await db.collection('pagos').where('rootId', '==', fixture.rootId).get();
    created = after.size - before.size; assert.equal(created, 1);
    const newPago = after.docs.find(doc => !before.docs.some(old => old.id === doc.id));
    assert.equal(Number(newPago.get('montoTotal')), 1123.75);
    await expect(dialog.getByRole('button', { name: 'Confirmar y registrar', exact: true })).toBeDisabled();
    await page.screenshot({ path: path.join(output, 'registered.png'), fullPage: true });
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'PASS', realRoute: '/pagos', auth: 'emulator', callableTransport: 'emulator', storage: 'emulator', registered: created, implicitRegistrations: 0, productionActions: 0 }, null, 2));
    console.log(JSON.stringify({ status: 'PASS', registered: created, implicitRegistrations: 0, productionActions: 0 }));
  } catch (error) { const page = browser.contexts()[0]?.pages()[0]; if (page) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(output, 'failure-text.txt'), await page.locator('body').innerText().catch(() => 'unavailable')); } throw error; } finally { await browser.close(); await admin.app().delete(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
