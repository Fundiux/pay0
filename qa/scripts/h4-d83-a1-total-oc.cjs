const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");
const ts = require("typescript");

const root = process.argv[2];
const auditDir = process.argv[3];

if (!root || !auditDir) {
  throw new Error("Faltan argumentos QA H4-D83-A1.");
}

const requireFromRoot = Module.createRequire(
  path.join(root, "package.json"),
);
const XLSX = requireFromRoot("xlsx");

const parserPath = path.join(
  root,
  "src",
  "lib",
  "ordenCompraParser.ts",
);
const helperPath = path.join(
  root,
  "src",
  "lib",
  "ordenCompraTotalResolver.ts",
);

const parser = fs.readFileSync(parserPath, "utf8");
const helperSource = fs.readFileSync(helperPath, "utf8");

const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
  fileName: helperPath,
  reportDiagnostics: true,
});

const diagnostics = transpiled.diagnostics || [];

if (diagnostics.length > 0) {
  const formatted = diagnostics
    .map((diagnostic) =>
      ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      ),
    )
    .join("\n");

  throw new Error(
    `No se pudo transpilar el resolver semántico:\n${formatted}`,
  );
}

const compiledHelperPath = path.join(
  root,
  "qa",
  ".h4-d83-a1-total-resolver.cjs",
);

fs.writeFileSync(
  compiledHelperPath,
  transpiled.outputText,
  "utf8",
);

const {
  normalizeOrdenCompraSheetKey,
  resolveOrdenCompraTotalsFromFile,
} = require(compiledHelperPath);

let passed = 0;
const results = [];

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  results.push({
    name,
    ok,
    detail,
  });

  if (!ok) {
    console.error(`FAIL ${name}${detail ? ` | ${detail}` : ""}`);
    process.exitCode = 1;
    return;
  }

  passed += 1;
  console.log(`PASS ${name}${detail ? ` | ${detail}` : ""}`);
}

function bufferArrayBuffer(buffer) {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
}

function fileLike(name, buffer) {
  return {
    name,
    async arrayBuffer() {
      return bufferArrayBuffer(buffer);
    },
  };
}

async function resolveBuffer(name, buffer, sheetName = "OC") {
  const map = await resolveOrdenCompraTotalsFromFile(
    fileLike(name, buffer),
  );

  return (
    map.get(normalizeOrdenCompraSheetKey(sheetName)) ||
    (map.size === 1
      ? Array.from(map.values())[0]
      : null)
  );
}

function workbookBuffer(rows, sheetName = "OC") {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    sheetName,
  );

  return XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  });
}

function findNamedFile(
  baseDirectory,
  fileName,
  maxDepth = 4,
) {
  if (
    !baseDirectory ||
    !fs.existsSync(baseDirectory)
  ) {
    return null;
  }

  const queue = [
    {
      directory: baseDirectory,
      depth: 0,
    },
  ];

  const ignored = new Set([
    "node_modules",
    ".git",
    ".next",
    "AppData",
    "__pay0_backups",
    "audit",
  ]);

  while (queue.length > 0) {
    const current = queue.shift();

    let entries;

    try {
      entries = fs.readdirSync(
        current.directory,
        {
          withFileTypes: true,
        },
      );
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(
        current.directory,
        entry.name,
      );

      if (
        entry.isFile() &&
        entry.name.toLowerCase() ===
          fileName.toLowerCase()
      ) {
        return full;
      }

      if (
        entry.isDirectory() &&
        current.depth < maxDepth &&
        !ignored.has(entry.name)
      ) {
        queue.push({
          directory: full,
          depth: current.depth + 1,
        });
      }
    }
  }

  return null;
}

async function run() {
  check(
    "parser compartido tiene wrapper semántico",
    parser.includes(
      "H4_D83_A1_SEMANTIC_TOTAL_WRAPPER_BEGIN",
    ),
  );

  check(
    "parser conserva implementación legacy",
    parser.includes(
      "parseOrdenCompraWorkbookFileLegacyH4D83A1",
    ),
  );

  check(
    "parseOrdenCompraFile delega al workbook corregido",
    /\bparseOrdenCompraFile\b[\s\S]{0,7000}\bparseOrdenCompraWorkbookFile\s*\(/.test(
      parser,
    ),
  );

  check(
    "resolver excluye SUBTOTAL",
    helperSource.includes(
      "SUBTOTAL no se usa como respaldo",
    ) &&
      helperSource.includes(
        "FORBIDDEN_TOTAL_LABELS",
      ),
  );

  check(
    "resolver exige etiquetas exactas autorizadas",
    helperSource.includes(
      '["TOTAL A PAGAR", 140]',
    ) &&
      helperSource.includes(
        '["TOTAL", 120]',
      ) &&
      helperSource.includes(
        "TOTAL_LABEL_PRIORITY.has(label)",
      ),
  );

  check(
    "resolver valida aritmética con centavo",
    helperSource.includes(
      "arithmeticDelta <= 0.01",
    ),
  );

  const syntheticMoved = await resolveBuffer(
    "synthetic-moved.xlsx",
    workbookBuffer([
      ["Orden de Compra"],
      [],
      [],
      [null, null, null, null, null, "SUBTOTAL", 1000],
      [null, null, null, null, null, "IVA", 160],
      [null, null, null, null, null, "TOTAL", 1160],
    ]),
  );

  check(
    "sintético ignora subtotal aunque aparezca primero",
    syntheticMoved?.ok === true &&
      syntheticMoved.total === 1160,
    JSON.stringify(syntheticMoved),
  );

  const syntheticRelocated = await resolveBuffer(
    "synthetic-relocated.xlsx",
    workbookBuffer([
      [],
      ["SUBTOTAL", 2500],
      ["IVA 16%", 400],
      ["TOTAL A PAGAR", 2900],
    ]),
  );

  check(
    "sintético no depende de fila ni columna",
    syntheticRelocated?.ok === true &&
      syntheticRelocated.total === 2900,
    JSON.stringify(syntheticRelocated),
  );

  const syntheticSubtotalOnly = await resolveBuffer(
    "synthetic-subtotal-only.xlsx",
    workbookBuffer([
      ["SUBTOTAL", 1000],
      ["IVA", 160],
    ]),
  );

  check(
    "sintético bloquea subtotal sin etiqueta total",
    syntheticSubtotalOnly?.ok === false &&
      syntheticSubtotalOnly.total === 0,
    JSON.stringify(syntheticSubtotalOnly),
  );

  const syntheticMismatch = await resolveBuffer(
    "synthetic-mismatch.xlsx",
    workbookBuffer([
      ["SUBTOTAL", 1000],
      ["IVA", 160],
      ["TOTAL", 1000],
    ]),
  );

  check(
    "sintético bloquea total aritméticamente inconsistente",
    syntheticMismatch?.ok === false &&
      syntheticMismatch.total === 0,
    JSON.stringify(syntheticMismatch),
  );

  const syntheticExactOnly = await resolveBuffer(
    "synthetic-exact-only.xlsx",
    workbookBuffer([
      ["TOTAL", 725.5],
    ]),
  );

  check(
    "sintético acepta total exacto único sin componentes",
    syntheticExactOnly?.ok === true &&
      syntheticExactOnly.total === 725.5 &&
      syntheticExactOnly.confidence === "MEDIA",
    JSON.stringify(syntheticExactOnly),
  );

  const expectedFiles = [
    {
      name:
        "OC_01_AIMIERA_9616.40_PAGO_32909.20_CLIENTE_DAL_CSF_2026.xlsx",
      expected: 9616.4,
    },
    {
      name:
        "OC_01_AIMIERA_11344.80_PAGO_38001.60_CLIENTE_DAL_CSF_2026.xlsx",
      expected: 11344.8,
    },
    {
      name:
        "OC_02_AIMIERA_11472.40_PAGO_32909.20_CLIENTE_DAL_CSF_2026.xlsx",
      expected: 11472.4,
    },
    {
      name:
        "OC_02_AIMIERA_12272.80_PAGO_38001.60_CLIENTE_DAL_CSF_2026.xlsx",
      expected: 12272.8,
    },
    {
      name:
        "OC_03_AIMIERA_11820.40_PAGO_32909.20_CLIENTE_DAL_CSF_2026.xlsx",
      expected: 11820.4,
    },
    {
      name:
        "OC_03_AIMIERA_14384.00_PAGO_38001.60_CLIENTE_DAL_CSF_2026.xlsx",
      expected: 14384,
    },
  ];

  const home = os.homedir();
  const roots = [
    path.join(home, "Downloads"),
    path.join(home, "Desktop"),
    root,
  ];

  for (const expectedFile of expectedFiles) {
    let located = null;

    for (const searchRoot of roots) {
      located = findNamedFile(
        searchRoot,
        expectedFile.name,
      );

      if (located) break;
    }

    check(
      `encuentra ${expectedFile.name}`,
      Boolean(located),
      located || "NO ENCONTRADO",
    );

    if (!located) continue;

    const result = await resolveBuffer(
      expectedFile.name,
      fs.readFileSync(located),
      "OC",
    );

    check(
      `total correcto ${expectedFile.name}`,
      result?.ok === true &&
        Math.abs(
          result.total -
            expectedFile.expected,
        ) <= 0.01 &&
        result.arithmeticValid === true,
      JSON.stringify(result),
    );
  }

  fs.writeFileSync(
    path.join(auditDir, "qa-results.json"),
    JSON.stringify(
      {
        passed,
        total: results.length,
        ok: results.every((item) => item.ok),
        results,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  fs.rmSync(compiledHelperPath, {
    force: true,
  });

  if (process.exitCode) {
    throw new Error(
      `QA H4-D83-A1 falló: ${passed}/${results.length}.`,
    );
  }

  console.log(
    `H4-D83-A1 QA PASS: ${passed}/${results.length}.`,
  );
}

run().catch((error) => {
  try {
    fs.rmSync(compiledHelperPath, {
      force: true,
    });
  } catch {
    // Sin acción.
  }

  console.error(
    error instanceof Error
      ? error.stack || error.message
      : String(error),
  );
  process.exit(1);
});
