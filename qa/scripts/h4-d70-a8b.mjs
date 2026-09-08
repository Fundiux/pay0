import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();

function loadTypeScript() {
  for (const packageFile of [
    path.join(root, "package.json"),
    path.join(root, "functions", "package.json"),
  ]) {
    if (!fs.existsSync(packageFile)) continue;

    try {
      return createRequire(packageFile)("typescript");
    } catch {}
  }

  throw new Error("TypeScript no disponible.");
}

const ts = loadTypeScript();

function transpileModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;

  const module = { exports: {} };
  const factory = new Function(
    "module",
    "exports",
    "require",
    output,
  );

  factory(module, module.exports, createRequire(filePath));
  return module.exports;
}

const sharedFile = path.join(
  root,
  "src",
  "lib",
  "solicitudes",
  "operationOptions.ts",
);

const nuevaFile = path.join(
  root,
  "src",
  "components",
  "NuevaSolicitudModal.tsx",
);

const masivaFile = path.join(
  root,
  "src",
  "components",
  "OrdenCompraMasivaModal.tsx",
);

const shared = transpileModule(sharedFile);

const corpus = [
  "FACTURA SUBTOTAL",
  "factura subtotal",
  "Factura Subtotal",
  "  factura subtotal  ",
  "FACTURA_SUBTOTAL",
  "factura_subtotal",
  "FACTURA-SUBTOTAL",
  "factura-subtotal",
  "FACTÚRA SUBTOTAL",
  "facturá subtotal",
  "fáctura subtotal",
  "factura subtotál",
  "otro",
  "",
];

for (const input of corpus) {
  const expected = String(input ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

  const actual = String(
    shared.normalizeSolicitudOperationText(input) ?? "",
  );

  if (actual !== expected) {
    throw new Error(
      `Normalizador canonico difiere para ${JSON.stringify(input)}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    );
  }
}

const accepted = [
  { label: "FACTURA SUBTOTAL", value: "otro" },
  { label: "FACTÚRA SUBTOTAL", value: "otro" },
  { label: "otro", value: "factura_subtotal" },
  { label: "otro", value: "FACTURA-SUBTOTAL" },
  { label: "extra factura subtotal", value: "otro" },
];

for (const option of accepted) {
  const result =
    shared.findFacturaSubtotalOperation([option]);

  if (result !== option) {
    throw new Error(
      `No reconocio opcion valida: ${JSON.stringify(option)}`,
    );
  }
}

const rejected = [
  { label: "subtotal factura", value: "otro" },
  { label: "factura/subtotal", value: "otro" },
  { label: "otro", value: "subtotal" },
  { label: "otro", value: "factura" },
];

for (const option of rejected) {
  const result =
    shared.findFacturaSubtotalOperation([option]);

  if (result !== null) {
    throw new Error(
      `Reconocio opcion invalida: ${JSON.stringify(option)}`,
    );
  }
}

for (const filePath of [nuevaFile, masivaFile]) {
  const source = fs.readFileSync(filePath, "utf8");

  if (
    source.includes(
      "function findFacturaSubtotalOperation",
    ) ||
    source.includes(
      "const findFacturaSubtotalOperation",
    )
  ) {
    throw new Error(
      `Matcher local todavia presente en ${filePath}.`,
    );
  }

  if (
    !source.includes(
      "@/lib/solicitudes/operationOptions",
    )
  ) {
    throw new Error(
      `Import canonico ausente en ${filePath}.`,
    );
  }
}

const nuevaSource = fs.readFileSync(
  nuevaFile,
  "utf8",
);

if (
  nuevaSource.includes(
    "findFacturaSubtotalOperation()",
  )
) {
  throw new Error(
    "NuevaSolicitud conserva llamada sin operationOptions.",
  );
}

console.log("QA H4-D70-A8B: 14/14 OK");
