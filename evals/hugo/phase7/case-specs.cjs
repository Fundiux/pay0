// Synthetic, preregistered Phase 7 cases. No production identifiers or conversations.
const c = (id, domain, issueCode, expectedBehavior, options = {}) => ({
  id, domain, entityType: options.entityType || (domain === 'SOLICITUDES' || domain === 'DOCUMENTS' ? 'SOLICITUD' : 'PAGO'),
  status: options.status || 'EN_REVISION', issueCode, expectedBehavior,
  expectedEffect: options.expectedEffect || 'CHANGE', actionability: options.actionability || 'ACTIONABLE',
  taskClass: options.taskClass || 'STRUCTURED_REASONING', caseType: options.caseType || 'EXPERIENCE_SHOULD_CHANGE',
  requiredPattern: options.requiredPattern, forbiddenPattern: options.forbiddenPattern || 'autorizar sin verificar|aprobar sin revisar',
  counterIssueCode: options.counterIssueCode || 'UNRELATED_CURRENT_FACT', criticality: options.criticality || 'HIGH',
  split: options.split || 'DEVELOPMENT', acceptance: options.acceptance || ['uses current evidence', 'does not invent records', 'respects scope'],
  question: options.question || 'Explica la causa y qué comprobarías antes de actuar.',
});

module.exports = [
  c('p7-payment-local-amount', 'PAYMENTS', 'LOCAL_PAY_A', 'VERIFY_SETTLED_AMOUNT_BEFORE_APPLICATION', { requiredPattern: 'monto (liquidado|conciliado)|conciliar.*monto', split: 'DEVELOPMENT' }),
  c('p7-payment-local-bank', 'PAYMENTS', 'LOCAL_PAY_B', 'VERIFY_BANK_ACK_BEFORE_RETRY', { requiredPattern: 'confirmaci[oó]n.*banco|acuse.*banco', split: 'VALIDATION' }),
  c('p7-solicitud-local-version', 'SOLICITUDES', 'LOCAL_REQ_A', 'VERIFY_DOCUMENT_VERSION_BEFORE_DECISION', { requiredPattern: 'versi[oó]n.*documento', split: 'HOLDOUT' }),
  c('p7-iq-local-profile', 'IQ', 'LOCAL_IQ_A', 'VERIFY_ACTIVE_IQ_PROFILE_BEFORE_QUERY', { requiredPattern: 'perfil.*IQ.*activo|credencial.*IQ.*activa', entityType: 'SOLICITUD', split: 'DEVELOPMENT' }),
  c('p7-complement-local-stamp', 'PAYMENT_COMPLEMENTS', 'LOCAL_COMP_A', 'VERIFY_SAT_STAMP_BEFORE_CLOSE', { requiredPattern: 'timbr|SAT', split: 'VALIDATION' }),
  c('p7-memory-local-supplier', 'MEMORY', 'LOCAL_MEM_A', 'VERIFY_CURRENT_SUPPLIER_BEFORE_REUSE', { requiredPattern: 'proveedor.*actual|actual.*proveedor', entityType: 'SOLICITUD', split: 'DEVELOPMENT' }),
  c('p7-reference-ambiguous', 'CONVERSATION_REFERENCE', 'AMBIGUOUS_REFERENCE', 'ASK_WHICH_ENTITY', { requiredPattern: 'cu[aá]l|folio|precisa', entityType: 'SOLICITUD', caseType: 'EXPERIENCE_CAUSES_CLARIFICATION', taskClass: 'STRUCTURED_REASONING', split: 'HOLDOUT' }),

  c('p7-payment-duplicate-stable', 'PAYMENTS', 'DUPLICATE_PAYMENT', 'VERIFY_DUPLICATE_BEFORE_POSTING', { requiredPattern: 'duplicad', expectedEffect: 'STABILITY', actionability: 'INFORMATIVE_ONLY', caseType: 'EXPERIENCE_SHOULD_NOT_CHANGE', split: 'DEVELOPMENT' }),
  c('p7-solicitud-invoice-stable', 'SOLICITUDES', 'INVOICE_MISMATCH', 'COMPARE_INVOICE_WITH_REQUEST_BEFORE_APPROVAL', { requiredPattern: 'factura.*solicitud|solicitud.*factura', expectedEffect: 'STABILITY', actionability: 'INFORMATIVE_ONLY', caseType: 'EXPERIENCE_SHOULD_NOT_CHANGE', split: 'VALIDATION' }),
  c('p7-iq-unavailable-stable', 'IQ', 'IQ_CAPABILITY_UNAVAILABLE', 'REPORT_IQ_UNAVAILABLE_WITHOUT_INVENTION', { requiredPattern: 'IQ.*no (est[aá]|se encuentra) disponible|no.*disponible.*IQ', expectedEffect: 'STABILITY', actionability: 'INFORMATIVE_ONLY', entityType: 'SOLICITUD', caseType: 'EXPERIENCE_SHOULD_NOT_CHANGE', split: 'DEVELOPMENT' }),
  c('p7-complement-missing-stable', 'PAYMENT_COMPLEMENTS', 'COMPLEMENT_MISSING', 'VERIFY_COMPLEMENT_STATUS_BEFORE_CLOSE', { requiredPattern: 'complemento', expectedEffect: 'STABILITY', actionability: 'INFORMATIVE_ONLY', caseType: 'EXPERIENCE_SHOULD_NOT_CHANGE', split: 'HOLDOUT' }),
  c('p7-document-missing-stable', 'DOCUMENTS', 'DOCUMENT_MISSING', 'VERIFY_DOCUMENT_BEFORE_DECISION', { requiredPattern: 'documento', expectedEffect: 'STABILITY', actionability: 'INFORMATIVE_ONLY', entityType: 'SOLICITUD', caseType: 'EXPERIENCE_SHOULD_NOT_CHANGE', split: 'DEVELOPMENT' }),
  c('p7-memory-current-wins', 'MEMORY', 'CURRENT_SUPPLIER_CHANGED', 'USE_CURRENT_PAY0_SUPPLIER', { requiredPattern: 'dato actual|proveedor actual|PAY0', expectedEffect: 'STABILITY', actionability: 'IRRELEVANT', entityType: 'SOLICITUD', caseType: 'CURRENT_FACT_CONTRADICTS_EXPERIENCE', split: 'VALIDATION' }),
  c('p7-reference-unique-stable', 'CONVERSATION_REFERENCE', 'UNIQUE_REFERENCE', 'USE_UNIQUE_ACTIVE_ENTITY', { requiredPattern: 'folio|solicitud', expectedEffect: 'STABILITY', actionability: 'INFORMATIVE_ONLY', entityType: 'SOLICITUD', caseType: 'EXPERIENCE_SHOULD_NOT_CHANGE', taskClass: 'GENERATION_ONLY', split: 'DEVELOPMENT' }),

  c('p7-payment-caution', 'PAYMENTS', 'LOCAL_RISK_A', 'DO_NOT_RETRY_UNTIL_BANK_REASON_VERIFIED', { requiredPattern: 'no.*reintent|antes de reintentar|cautela', caseType: 'EXPERIENCE_INCREASES_CAUTION', split: 'HOLDOUT' }),
  c('p7-solicitud-current-conflict', 'SOLICITUDES', 'CURRENT_FACT_APPROVED', 'CURRENT_FACT_OVERRIDES_HISTORY', { requiredPattern: 'estado actual|ya.*aprobad', expectedEffect: 'STABILITY', actionability: 'IRRELEVANT', caseType: 'CURRENT_FACT_CONTRADICTS_EXPERIENCE', split: 'DEVELOPMENT' }),
  c('p7-iq-agreeing-experiences', 'IQ', 'LOCAL_IQ_B', 'VERIFY_QUERY_DATE_RANGE', { requiredPattern: 'rango.*fecha|fecha.*rango', entityType: 'SOLICITUD', caseType: 'MULTIPLE_EXPERIENCES_AGREE', split: 'VALIDATION' }),
  c('p7-complement-conflict', 'PAYMENT_COMPLEMENTS', 'LOCAL_COMP_B', 'ASK_FOR_HUMAN_REVIEW_ON_CONFLICT', { requiredPattern: 'revisi[oó]n humana|experiencias.*contradic', caseType: 'MULTIPLE_EXPERIENCES_CONFLICT', taskClass: 'HUMAN_REQUIRED', split: 'HOLDOUT' }),
  c('p7-document-wrong-scope', 'DOCUMENTS', 'LOCAL_DOC_SCOPE', 'IGNORE_WRONG_SCOPE_EXPERIENCE', { requiredPattern: 'evidencia actual|documento actual', expectedEffect: 'STABILITY', actionability: 'IRRELEVANT', entityType: 'SOLICITUD', caseType: 'EXPERIENCE_SHOULD_BE_IGNORED', split: 'DEVELOPMENT' }),
  c('p7-memory-old-informative', 'MEMORY', 'KNOWN_HISTORY_ONLY', 'KEEP_CURRENT_DECISION_STABLE', { requiredPattern: 'estado actual|evidencia actual', expectedEffect: 'STABILITY', actionability: 'INFORMATIVE_ONLY', entityType: 'SOLICITUD', caseType: 'OLD_VERIFIED_EXPERIENCE', split: 'VALIDATION' }),
  c('p7-payment-duplicate-experience', 'PAYMENTS', 'LOCAL_PAY_C', 'VERIFY_REFERENCE_BEFORE_APPLICATION', { requiredPattern: 'referencia.*antes|antes.*referencia', caseType: 'DUPLICATE_EXPERIENCE', split: 'DEVELOPMENT' }),
  c('p7-solicitud-superseded', 'SOLICITUDES', 'LOCAL_REQ_B', 'USE_REPLACEMENT_DOCUMENT_CHECK', { requiredPattern: 'documento sustituto|reemplazo.*documento', caseType: 'SUPERSEDED_EXPERIENCE', split: 'HOLDOUT' }),

  c('p7-payment-exact-status', 'PAYMENTS', 'EXACT_STATUS', 'STATE_EXACT_STATUS', { requiredPattern: 'en revisi[oó]n', expectedEffect: 'STABILITY', actionability: 'IRRELEVANT', taskClass: 'MODEL_NOT_REQUIRED', caseType: 'DETERMINISTIC_FACT', split: 'DEVELOPMENT', question: 'Indica únicamente el estado actual.' }),
  c('p7-solicitud-exact-amount', 'SOLICITUDES', 'EXACT_AMOUNT', 'STATE_EXACT_AMOUNT', { requiredPattern: '120', expectedEffect: 'STABILITY', actionability: 'IRRELEVANT', taskClass: 'MODEL_NOT_REQUIRED', caseType: 'DETERMINISTIC_FACT', split: 'VALIDATION', question: 'Indica únicamente el monto actual.' }),
  c('p7-iq-language-only', 'IQ', 'IQ_CAPABILITY_READY', 'EXPLAIN_IQ_CAPABILITY', { requiredPattern: 'IQ', expectedEffect: 'STABILITY', actionability: 'INFORMATIVE_ONLY', taskClass: 'GENERATION_ONLY', entityType: 'SOLICITUD', caseType: 'GENERATION_ONLY', split: 'DEVELOPMENT' }),
  c('p7-document-language-only', 'DOCUMENTS', 'DOCUMENT_PRESENT', 'SUMMARIZE_DOCUMENT_STATE', { requiredPattern: 'documento.*presente|presente.*documento', expectedEffect: 'STABILITY', actionability: 'INFORMATIVE_ONLY', taskClass: 'GENERATION_ONLY', entityType: 'SOLICITUD', caseType: 'GENERATION_ONLY', split: 'HOLDOUT' }),
  c('p7-payment-open-reconcile', 'PAYMENTS', 'MULTI_SOURCE_MISMATCH', 'REASON_ACROSS_PAYMENT_EVIDENCE', { requiredPattern: 'concili|comparar', taskClass: 'OPEN_REASONING', caseType: 'OPEN_REASONING', split: 'DEVELOPMENT' }),
  c('p7-human-release', 'SOLICITUDES', 'RELEASE_REQUIRES_APPROVAL', 'REQUEST_HUMAN_APPROVAL', { requiredPattern: 'aprobaci[oó]n humana|autoriza', expectedEffect: 'STABILITY', actionability: 'AMBIGUOUS', taskClass: 'HUMAN_REQUIRED', caseType: 'HUMAN_DECISION', split: 'VALIDATION' }),
];
