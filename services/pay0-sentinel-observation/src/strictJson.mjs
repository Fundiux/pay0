/** Bounded JSON parser for untrusted raw HTTP and decoded LogEntry bytes.
 * Duplicate keys are compared after JSON string unescaping. No reviver, getters,
 * prototype assignment, provider text in errors, or transport authentication. */
export function parseStrictJson(bytes, { maxBytes, maxDepth = 16, maxNodes = 2048 } = {}) {
  const fail = () => { throw Error('INVALID_JSON'); };
  if (!(bytes instanceof Uint8Array) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16384 ||
      !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 16 ||
      !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 2048 || bytes.byteLength > maxBytes) fail();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail(); }
  let position = 0, nodes = 0;
  const count = () => { if (++nodes > maxNodes) fail(); };
  const whitespace = () => { while (position < text.length && /[\x20\t\r\n]/.test(text[position])) position++; };
  function string() {
    count();
    if (text[position] !== '"') fail();
    const start = position++;
    while (position < text.length) {
      const code = text.charCodeAt(position++);
      if (code === 34) {
        try { return JSON.parse(text.slice(start, position)); } catch { fail(); }
      }
      if (code < 32) fail();
      if (code === 92) {
        const escape = text[position++];
        if (escape === 'u') {
          if (!/^[a-fA-F0-9]{4}$/.test(text.slice(position, position + 4))) fail();
          position += 4;
        } else if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) fail();
      }
    }
    fail();
  }
  function value(depth) {
    whitespace();
    const token = text[position];
    if (token === '"') return string();
    count();
    if (token === '{' || token === '[') {
      if (depth >= maxDepth) fail();
      position++; whitespace();
      const object = token === '{', end = object ? '}' : ']';
      const result = object ? {} : [], names = new Set();
      if (text[position] === end) { position++; return result; }
      for (;;) {
        whitespace();
        if (object) {
          const key = string(); whitespace();
          if (names.has(key) || text[position++] !== ':') fail();
          names.add(key);
          const item = value(depth + 1);
          Object.defineProperty(result, key, { value: item, writable: true, enumerable: true, configurable: true });
        } else result.push(value(depth + 1));
        whitespace();
        if (text[position] === end) { position++; return result; }
        if (text[position++] !== ',') fail();
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]]) {
      if (text.startsWith(literal, position)) { position += literal.length; return result; }
    }
    const number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
    number.lastIndex = position;
    const match = number.exec(text);
    if (!match) fail();
    position = number.lastIndex;
    const result = Number(match[0]);
    if (!Number.isFinite(result) || (Number.isInteger(result) && !Number.isSafeInteger(result))) fail();
    return result;
  }
  const result = value(0); whitespace();
  if (position !== text.length) fail();
  return result;
}
