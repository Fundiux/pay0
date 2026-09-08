function cleanFilename(filename: string | null | undefined, fallback: string): string {
  const value = (filename || "").trim() || fallback;
  return value.replace(/[\\/:*?"<>|]+/g, "_");
}

function filenameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const rawPath = parsed.pathname.split("/").filter(Boolean).pop();
    if (!rawPath) return null;

    const decoded = decodeURIComponent(rawPath);
    const parts = decoded.split("/");
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    link.rel = "noopener";
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }
}

export async function forceDownloadFromUrl(url: string, filename: string | null | undefined): Promise<void> {
  if (!url || typeof url !== "string") {
    throw new Error("URL de descarga invalida.");
  }

  const safeFilename = cleanFilename(filename, filenameFromUrl(url) || "documento");

  const response = await fetch(url, {
    method: "GET",
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar el archivo (${response.status}).`);
  }

  const blob = await response.blob();

  if (!blob || blob.size <= 0) {
    throw new Error("El archivo descargado esta vacio.");
  }

  triggerBlobDownload(blob, safeFilename);
}