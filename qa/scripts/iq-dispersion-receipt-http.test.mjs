import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchIqDispersionReceipt } from "../../functions/src/modules/dispersionDocuments/iqReceiptHttp.ts";

const origin = "https://sistema-3-erp.vercel.app";
const pdf = Buffer.from("%PDF-1.7\nsynthetic receipt\n");
const input = (fetcher) => ({
  apiOrigin: origin,
  username: "synthetic",
  password: "synthetic",
  folio: "433147",
  fetcher,
});
const login = () => new Response(JSON.stringify({ access_token: "synthetic-token" }), { status: 201 });

test("unavailable IQ voucher creates no file request", async () => {
  const requests = [];
  const result = await fetchIqDispersionReceipt(input(async (url, init) => {
    requests.push([url.pathname, init.method]);
    if (url.pathname === "/users/sessions") return login();
    if (url.pathname === "/dispersions/voucher/433147") return new Response("", { status: 404 });
    throw Error("Unexpected request");
  }));
  assert.equal(result.status, "NOT_AVAILABLE");
  assert.deepEqual(requests, [
    ["/users/sessions", "POST"],
    ["/dispersions/voucher/433147", "GET"],
  ]);
});

test("imports an authenticated IQ voucher through an approved storage URL", async () => {
  const requests = [];
  const result = await fetchIqDispersionReceipt(input(async (url, init) => {
    requests.push([url.origin, url.pathname, init.method, init.headers]);
    if (url.pathname === "/users/sessions") return login();
    if (url.pathname === "/dispersions/voucher/433147") {
      return new Response(JSON.stringify({ url: "https://storage.googleapis.com/iq-receipts/433147.pdf" }), { status: 200 });
    }
    if (url.pathname === "/iq-receipts/433147.pdf") return new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } });
    throw Error("Unexpected request");
  }));
  assert.equal(result.status, "AVAILABLE");
  assert.equal(result.filename, "IQ-433147.pdf");
  assert.deepEqual(result.bytes, pdf);
  assert.equal(requests[2][2], "GET");
  assert.deepEqual(requests[2][3], {});
  assert.equal(requests.filter((row) => row[2] === "POST").length, 1);
});

test("rejects a private voucher URL before a file request", async () => {
  let requests = 0;
  await assert.rejects(() => fetchIqDispersionReceipt(input(async (url) => {
    requests++;
    if (url.pathname === "/users/sessions") return login();
    return new Response(JSON.stringify({ url: "https://127.0.0.1/private.pdf" }), { status: 200 });
  })), /IQ_RECEIPT_HOST_UNVERIFIED/);
  assert.equal(requests, 2);
});

test("rejects a file that exceeds the PAY0 document limit", async () => {
  await assert.rejects(() => fetchIqDispersionReceipt(input(async (url) => {
    if (url.pathname === "/users/sessions") return login();
    if (url.pathname === "/dispersions/voucher/433147") {
      return new Response(JSON.stringify({ url: "https://storage.googleapis.com/iq-receipts/large.pdf" }), { status: 200 });
    }
    return new Response(Buffer.concat([pdf, Buffer.alloc(1024 * 1024)]), { status: 200 });
  })), /IQ_RECEIPT_TOO_LARGE/);
});
