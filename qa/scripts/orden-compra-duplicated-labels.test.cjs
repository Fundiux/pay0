const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const ExcelJS = require("exceljs");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, filename);
};

const { resolveOrdenCompraTotalsFromFile } = require("../../src/lib/ordenCompraTotalResolver.ts");

async function main() {
  for (const [name, subtotal, iva, expected] of [
    ["orden-con-etiquetas-duplicadas", 53701.82, 8592.29, 62294.11],
    ["orden-con-iva-unico", 100, 16, 116],
  ]) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("OC");
    for (const [row, label, amount] of [[2, "Subtotal:", subtotal], [3, "IVA:", iva], [4, "TOTAL:", expected]]) {
      sheet.getCell(`J${row}`).value = label;
      sheet.getCell(`K${row}`).value = label;
      sheet.getCell(`L${row}`).value = amount;
    }
    if (name === "orden-con-iva-unico") sheet.getCell("J3").value = null;
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const results = await resolveOrdenCompraTotalsFromFile({
      name: `${name}.xlsx`,
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    const result = results.get("OC");
    assert.equal(result?.ok, true, `${name}: ${result?.error}`);
    assert.equal(result.arithmeticValid, true, name);
    assert.equal(result.total, expected, name);
    console.log(`PASS ${name}: ${result.total}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
