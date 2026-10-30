import { inflateSync } from "node:zlib";
import {
  CANONICAL_SAT_PRODUCT_COUNT,
  CANONICAL_SAT_PRODUCTS_ZLIB_BASE64,
  CANONICAL_SAT_SOURCE_SHA256,
  CANONICAL_SAT_UNIT_COUNT,
  CANONICAL_SAT_UNITS_ZLIB_BASE64,
} from "./canonicalSatKeys.generated";

let snapshot: { products: Set<string>; units: Set<string> } | null = null;

function loadSnapshot() {
  if (snapshot) return snapshot;
  const productText = inflateSync(Buffer.from(CANONICAL_SAT_PRODUCTS_ZLIB_BASE64, "base64")).toString("ascii");
  const unitText = inflateSync(Buffer.from(CANONICAL_SAT_UNITS_ZLIB_BASE64, "base64")).toString("ascii");
  const products = new Set(productText.match(/.{8}/g) || []);
  const units = new Set(unitText.split("\n"));
  if (products.size !== CANONICAL_SAT_PRODUCT_COUNT || units.size !== CANONICAL_SAT_UNIT_COUNT) {
    throw new Error("CANONICAL_SAT_SNAPSHOT_INVALID");
  }
  snapshot = { products, units };
  return snapshot;
}

export function canonicalSatPairExists(productCode: string, unitCode: string): boolean {
  const { products, units } = loadSnapshot();
  return products.has(productCode) && units.has(unitCode);
}

export function canonicalSatSnapshotSourceSha256(): string {
  return CANONICAL_SAT_SOURCE_SHA256;
}
