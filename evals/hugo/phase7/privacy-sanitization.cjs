const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const fixture = { taskCode: 'VERIFY_DOCUMENT', behaviorCode: 'CHECK_BEFORE_APPROVAL', outcomeCode: 'COMPLETED', instrumentType: 'TRANSFER', bankType: 'NATIONAL',
  rootId: 'root-customer-acme', entityId: 'payment-7788', personName: 'Persona Sintetica', customerName: 'Cliente Ejemplo SA', vendorName: 'Proveedor Ejemplo',
  email: 'persona@example.test', taxId: 'XAXX010101000', accountNumber: '012345678901234567', documentUrl: 'https://example.test/private/document.pdf',
  freeText: 'La persona solicito revisar su cuenta y documento.', amount: 987654.32, financialState: 'REJECTED_BY_BANK', sourceDocument: 'synthetic-pdf-bytes' };
const pseudo = value => `p_${crypto.createHash('sha256').update(`phase7-eval-salt:${value}`).digest('hex').slice(0, 16)}`;
function sanitize(row) { return { taskCode: row.taskCode, behaviorCode: row.behaviorCode, outcomeCode: row.outcomeCode, instrumentType: row.instrumentType, bankType: row.bankType,
  rootRef: pseudo(row.rootId), entityRef: pseudo(row.entityId), amountBucket: row.amount < 10000 ? 'LOW' : row.amount < 100000 ? 'MEDIUM' : 'HIGH', financialStateCategory: 'REQUIRES_REVIEW' }; }
const sanitized = sanitize(fixture), serialized = JSON.stringify(sanitized);
const forbiddenValues = ['Persona Sintetica','Cliente Ejemplo SA','Proveedor Ejemplo','persona@example.test','XAXX010101000','012345678901234567','https://example.test/private/document.pdf','synthetic-pdf-bytes'];
const report = { schemaVersion: 'hugo-phase7-privacy-v1', syntheticOnly: true, checklist: [
  { category: 'structured task, behavior and outcome codes', handling: 'ALLOW_AFTER_REVIEW' },
  { category: 'root and entity identifiers', handling: 'PSEUDONYMIZE_WITH_MANAGED_SALT' },
  { category: 'names, email, tax and account identifiers', handling: 'EXCLUDE_OR_REDACT' },
  { category: 'documents, URLs, free text and transcripts', handling: 'EXCLUDE_BY_DEFAULT' },
  { category: 'amount and financial state', handling: 'BUCKET_AND_REVIEW' },
  { category: 'external training authorization', handling: 'SEPARATE_EXPLICIT_APPROVAL_REQUIRED' },
], sanitized, assertions: { directIdentifiersAbsent: forbiddenValues.every(value => !serialized.includes(value)), rawFreeTextAbsent: !('freeText' in sanitized), rawAmountAbsent: !('amount' in sanitized), rawDocumentAbsent: !('sourceDocument' in sanitized) },
  productionExportReadiness: 'NOT_READY', limitation: 'Synthetic demonstration only; managed salt, operational sampling, retention and privacy approval are not implemented.' };
fs.writeFileSync(path.join(__dirname, 'phase7-privacy-sanitization.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report.assertions));
