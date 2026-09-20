import { ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "@/lib/firebaseClient";
import { finalizeGlobalSatCatalogImport, initGlobalSatCatalogUpload } from "@/services/facturama";

function sha256(file: File): Promise<string> {
  return file.arrayBuffer().then(async (buffer) => {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}

export async function uploadAndImportGlobalSatCatalog(input: { file: File; versionLabel?: string; onProgress?: (progress: number) => void }) {
  if (!/\.db\.bz2$/i.test(input.file.name)) throw new Error("Selecciona el paquete SAT .db.bz2.");
  const sourceSha256 = await sha256(input.file);
  const prepared = await initGlobalSatCatalogUpload({ originalName: input.file.name, fileSize: input.file.size, sha256: sourceSha256, versionLabel: input.versionLabel || "" });
  const task = uploadBytesResumable(ref(storage, prepared.storagePath), input.file, { contentType: "application/x-bzip2", customMetadata: { sha256: sourceSha256, importid: prepared.importId } });
  await new Promise<void>((resolve, reject) => task.on("state_changed", (snapshot) => input.onProgress?.(snapshot.totalBytes ? Math.round(snapshot.bytesTransferred * 100 / snapshot.totalBytes) : 0), reject, resolve));
  return finalizeGlobalSatCatalogImport({ importId: prepared.importId });
}
