import { downloadPrivateDocument } from "@/lib/downloadPrivateDocument";

export function getAuthorizedDocumentErrorMessage(error: unknown): string {
  const code = String((error as any)?.code || "").toLowerCase().replace(/^functions\//, "");
  switch (code) {
    case "unauthenticated":
      return "Tu sesion termino. Inicia sesion nuevamente.";
    case "permission-denied":
      return "No tienes acceso a este documento.";
    case "not-found":
      return "El archivo ya no esta disponible.";
    case "failed-precondition":
      return "El documento no tiene informacion suficiente para descargarse.";
    case "invalid-argument":
      return "El documento no se puede identificar para la descarga.";
    default:
      return "No fue posible descargar temporalmente el documento.";
  }
}

export async function getAuthorizedDocumentDownloadUrl(uploadId: string): Promise<string> {
  try {
    return await downloadPrivateDocument("uploads", uploadId);
  } catch (error) {
    const sanitized = new Error(getAuthorizedDocumentErrorMessage(error));
    (sanitized as any).code = (error as any)?.code;
    throw sanitized;
  }
}
