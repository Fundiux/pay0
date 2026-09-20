import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "src/canonicos/formatos/LOGOS/Trostre.png");
const targets = [
  resolve(root, "public/brand/Trostre.png"),
  resolve(root, "functions/lib/assets/Trostre.png"),
];

for (const target of targets) {
  await mkdir(resolve(target, ".."), { recursive: true });
  await copyFile(source, target);
}

// Functions are deployed from functions/lib. Copy every canonical company
// logo into that artifact so quotation generation does not special-case one
// company or fall back to a text-only header.
const manifestPath = resolve(root, "src/canonicos/formatos/cotizaciones/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const canonicalCompaniesRoot = resolve(
  root,
  "src/canonicos/formatos/CONSTANCIAS/PAY0_CONSTANCIAS_CANONICAS_REGENERADAS_FINAL",
);
const functionLogoRoot = resolve(root, "functions/lib/assets/companies");
const functionQuotationRoot = resolve(root, "functions/lib/assets/cotizaciones");
const functionQuotationTemplateRoot = resolve(root, "functions/lib/assets/cotizaciones/templates/base");
await mkdir(functionLogoRoot, { recursive: true });
await mkdir(functionQuotationRoot, { recursive: true });
await mkdir(functionQuotationTemplateRoot, { recursive: true });

for (const filename of ["template.html", "template.css"]) {
  await copyFile(
    resolve(root, "src/canonicos/formatos/cotizaciones/templates/base", filename),
    resolve(functionQuotationTemplateRoot, filename),
  );
}

for (const template of manifest.templates || []) {
  const companyFolder = String(template.companyId || "").replace(/-/g, "_");
  const rfc = String(template.rfc || "").toUpperCase();
  if (!companyFolder || !rfc) continue;
  await copyFile(
    resolve(canonicalCompaniesRoot, companyFolder, "assets/logo.png"),
    resolve(functionLogoRoot, `${rfc}.png`),
  );
  // The published PDF is the visual contract for each company.  Runtime
  // generation starts from this page, rather than approximating it with one
  // generic layout and a different logo.
  await copyFile(
    resolve(root, "src/canonicos/formatos/cotizaciones", String(template.referencePdf)),
    resolve(functionQuotationRoot, String(template.referencePdf)),
  );
}

await copyFile(manifestPath, resolve(root, "functions/lib/assets/cotizaciones-manifest.json"));
