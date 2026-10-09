const zlib = require("node:zlib");

// Synthetic ink only; no person's signature or production data.
exports.signaturePng = function signaturePng() {
  const width = 600, height = 150;
  const bytes = Buffer.alloc((width * 4 + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    bytes[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const wave = 75 + 30 * Math.sin(x / 18) + 18 * Math.sin(x / 7);
      if (x > 75 && x < 525 && Math.abs(y - wave) < 2) bytes.writeUInt32BE(0x143c5cff, y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  function chunk(type, data) {
    const label = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    let crc = 0xffffffff;
    for (const value of Buffer.concat([label, data])) {
      crc ^= value;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, label, data, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(bytes)), chunk("IEND", Buffer.alloc(0))]);
};

exports.acceptance = { signerName: "Receptor sintético de pruebas", signerRole: "Responsable de almacén",
  receiptLocation: "Almacén de pruebas, muelle 2", receiptAddress: "Calle de Pruebas 123, Parque Industrial, Ciudad de México, CP 01000",
  observations: "Recepción completa; embalajes sin daño visible.", acceptedNoClaimPolicy: true };
