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
const { parseOrdenCompraWorkbookFile } = require("../../src/lib/ordenCompraParser.ts");

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

  const workbook = new ExcelJS.Workbook();
  const order = workbook.addWorksheet("Orden de Compra");
  const cells = {
    A1: "ORDEN DE COMPRA",
    A3: "P R O V E E D O R :",
    A6: "C L I E N T E :",
    C4: "Proveedor de prueba",
    C7: "Cliente de prueba",
    K7: "XAXX010101000",
    M9: "Método de Pago",
    N8: "G03 - Gastos en general",
    N9: "PPD - Pago en parcialidades o diferido",
    N10: "99 - Por definir",
    H13: "Servicio de prueba",
    N27: "MXN",
    O26: "Subtotal",
    Q26: 100,
    O27: "IVA",
    Q27: 16,
    O28: "Total",
    Q28: { formula: "Q26+Q27", result: 116 },
  };
  for (const [address, value] of Object.entries(cells)) order.getCell(address).value = value;
  order.mergeCells("O28:P28");
  const catalog = workbook.addWorksheet("CP", { state: "veryHidden" });
  catalog.getCell("A50001").value = "Catálogo";

  const bytes = await workbook.xlsx.writeBuffer();
  const [parsed, extraSheet] = await parseOrdenCompraWorkbookFile(new File([bytes], "orden-iq.xlsx"));
  assert.equal(extraSheet, undefined);
  assert.equal(parsed?.ok, true, parsed?.warnings.join(", "));
  assert.equal(parsed.proveedorNombre, "Proveedor de prueba");
  assert.equal(parsed.clienteNombre, "Cliente de prueba");
  assert.equal(parsed.rfc, "XAXX010101000");
  assert.equal(parsed.tipoFactura, "PPD");
  assert.equal(parsed.moneda, "MXN");
  assert.equal(parsed.montoSolicitud, 116);

  catalog.state = "visible";
  const oversized = await workbook.xlsx.writeBuffer();
  await assert.rejects(
    parseOrdenCompraWorkbookFile(new File([oversized], "orden-iq-con-hoja-visible-grande.xlsx")),
    /50,000 filas/,
  );
  console.log("PASS plantilla IQ con catálogo oculto y límite para hojas visibles");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
