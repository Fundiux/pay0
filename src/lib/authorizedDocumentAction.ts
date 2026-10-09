const localDocumentUrls = new Set<string>();
export function registerPrivateDocumentUrl(url: string): void {
  if (!url.startsWith("blob:")) throw new Error("URL local invalida.");
  localDocumentUrls.add(url);
}
export function isPrivateDocumentUrl(url: string): boolean { return localDocumentUrls.has(url); }
export function releasePrivateDocumentUrl(url: string): void {
  if (localDocumentUrls.delete(url)) URL.revokeObjectURL(url);
}
export function releaseAllPrivateDocumentUrls(): void {
  for (const url of [...localDocumentUrls]) releasePrivateDocumentUrl(url);
}

export async function runAuthorizedDocumentAction(
  uploadId: string,
  requestUrl: (uploadId: string) => Promise<string>,
  deliverUrl: (url: string) => void | Promise<void>,
): Promise<string> {
  const normalizedId = String(uploadId || "").trim();
  if (!normalizedId) throw new Error("Documento invalido.");
  const url = String(await requestUrl(normalizedId) || "").trim();
  if (!/^https:\/\//i.test(url) && !isPrivateDocumentUrl(url)) throw new Error("La descarga autorizada no devolvio una URL segura.");
  await deliverUrl(url);
  return url;
}
