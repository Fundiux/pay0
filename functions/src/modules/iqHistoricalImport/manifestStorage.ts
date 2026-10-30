import type { P4Manifest } from "./domain";

export const P4_MANIFEST_STORAGE_VERSION = "CHUNKED_JSON_V1";
export const P4_MANIFEST_CHUNK_CHARS = 180_000;

export function encodeManifestChunks(manifest: P4Manifest, chunkChars = P4_MANIFEST_CHUNK_CHARS): string[] {
  if (!Number.isInteger(chunkChars) || chunkChars < 1) throw new Error("P4_MANIFEST_CHUNK_SIZE_INVALID");
  const payload = JSON.stringify(manifest), chunks: string[] = [];
  for (let offset = 0; offset < payload.length; offset += chunkChars) chunks.push(payload.slice(offset, offset + chunkChars));
  return chunks;
}

export function decodeManifestChunks(chunks: string[]): P4Manifest {
  if (!chunks.length || chunks.some(chunk => typeof chunk !== "string" || !chunk.length)) throw new Error("P4_MANIFEST_CHUNKS_INVALID");
  return JSON.parse(chunks.join("")) as P4Manifest;
}

export function manifestChunkId(index: number): string {
  return String(index).padStart(5, "0");
}
