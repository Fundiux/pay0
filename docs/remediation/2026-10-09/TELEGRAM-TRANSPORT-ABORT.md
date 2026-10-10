# Telegram transport redaction and optional cancellation

Candidate isolated from integration2613559. No real Telegram calls, IAM or deploy.
Only telegram/service.ts changes; no recipient, USER, claim, retry or notifier policy.

The last optional argument is TelegramTransportOptions {signal?:AbortSignal} for
sendTelegramMessage, sendTelegramMessageWithKeyboard and sendTelegramDocumentBuffer
(after optional caption). Existing argument lists and successful JSON results remain
compatible. No timeout, retry or response-size default was added. HTTPS cancellation
destroys both request and response; fetch receives the original signal. Pre-abort
starts zero requests. Cancellation/network/non2xx/parse errors use only
TELEGRAM_DELIVERY_UNCONFIRMED, with no cause, response, token, URL, chat or raw body.
Late success after abort cannot return success. Cancellation does not prove that
Telegram did not receive the POST; delivery remains uncertain and must not trigger
automatic resend. This helper does not change existing caller retry policies.

Compatibility details: HTTP200 malformed JSON previously became {raw}; it now
rejects with the fixed error instead of returning raw provider material. HTTP200
JSON ok:false from sendMessage retains its existing result semantics; sendDocument
still rejects ok:false. Changing sendMessage semantic success is a separate audit.
Non2xx bodies are not read. Successful response buffering remains unbounded as
before: no published local response-size contract was found, so an arbitrary 1MiB
cap was not silently imposed. A future opt-in cap must mark overflow uncertain,
cancel the transport and preserve application delivery state; it needs separate
review of valid Telegram result sizes. This is not a complete memory bound.

Consumer inventory at2613559: nine external source modules. IQ pagoTelegramNotifications,
solicitudCreationCallables persist error text; solicitudCreateQueueCallables,
solicitudInvoiceImportCallables and solicitudStatusMonitorCallables swallow best-effort
notification errors. dispersionDocuments/service and telegram/clientNotifications
persist/log recipient error text. telegram/webhook logs error objects and stores
sendError; its successful result consumer reads .ok. telegram/callables exposes the
existing callable rejection. No caller parses the previous provider error string
or requires status/body/cause. Document wrappers return the successful result.
Existing callers do not pass a signal, so they do not automatically gain cancellation:
notifier candidate wiring must explicitly forward its deadline signal in a later
scoped change. Existing sensitive caller identifiers/log fields are outside scope.

23 synthetic tests PASS using real TypeScript transpilation and HTTPS/fetch fakes:
all three pre/during aborts, request/response destruction, status/network/parse/body
error redaction, late outcomes, no retry, and successful old signatures. Functions build PASS (tsc + canonical assets, session42400). No native network
test. Root review remains required before integration. All IAM candidate files remain untouched during this task.

Multipart correction: synthetic filename CRLF injected an extra header, and MIME
CR/LF reached fetch before correction (21PASS/2FAIL reproduction). Filename now
removes CR/LF and existing quote removal while preserving Unicode and normal names.
MIME containing CR or LF fails before request with the fixed error; no MIME
allowlist. Tests capture actual req.write JSON and fetch multipart bytes, checking
keyboard shape, caption, filename, custom MIME and Content-Length. All23PASS after
fix. Earlier build42400 predates this change; rebuild evidence recorded separately.
Rebuild final50501 PASS exit0 (tsc + canonical assets), after the CRLF change. TS frozen for central review.
