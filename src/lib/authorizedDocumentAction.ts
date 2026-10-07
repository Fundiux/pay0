export async function runAuthorizedDocumentAction(
  uploadId: string,
  requestUrl: (uploadId: string) => Promise<string>,
  deliverUrl: (url: string) => void | Promise<void>,
): Promise<string> {
  const normalizedId = String(uploadId || "").trim();
  if (!normalizedId) throw new Error("Documento invalido.");
  const url = String(await requestUrl(normalizedId) || "").trim();
  if (!/^https:\/\//i.test(url)) throw new Error("La descarga autorizada no devolvio una URL segura.");
  await deliverUrl(url);
  return url;
}
