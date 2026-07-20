// Minimal ZIP writer (STORE method — no compression) so multi-file exports can
// ship as ONE download with zero new dependencies. CSVs are small and mostly
// travel over an already-compressed HTTP response, so store-only is a feature:
// the writer stays ~150 auditable lines with no inflate/deflate surface at all.
//
// Pure byte assembly: the caller passes the entry date (no `new Date()` here),
// so output is deterministic and unit-testable byte-for-byte. Names and string
// contents are UTF-8 encoded and flagged as such (general-purpose bit 11), per
// APPNOTE.TXT 4.4.4 / Appendix D.

export type ZipEntry = {
  /** Forward-slash path inside the archive, e.g. "reports/t776.csv". */
  name: string;
  /** File body; strings are UTF-8 encoded. */
  data: string | Uint8Array;
};

/** CRC-32 (IEEE 802.3, the ZIP polynomial), table-driven. */
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * MS-DOS date/time pair from an ISO "YYYY-MM-DD" (midnight). DOS years are
 * offset from 1980 and clamp there — the format cannot represent earlier.
 */
export function dosDateTime(dateIso: string): { date: number; time: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  const year = m ? Number(m[1]) : 1980;
  const month = m ? Number(m[2]) : 1;
  const day = m ? Number(m[3]) : 1;
  const y = Math.min(Math.max(year, 1980), 2107) - 1980;
  return { date: (y << 9) | (Math.min(Math.max(month, 1), 12) << 5) | Math.min(Math.max(day, 1), 31), time: 0 };
}

const encoder = new TextEncoder();

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  length = 0;

  bytes(b: Uint8Array): void {
    this.chunks.push(b);
    this.length += b.length;
  }

  u16(v: number): void {
    this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }

  u32(v: number): void {
    this.bytes(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
}

const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const VERSION = 20; // 2.0 — plain store, no features beyond that

/**
 * Build a complete ZIP archive from entries. `dateIso` stamps every entry with
 * the same (caller-supplied) date so the bytes are reproducible. Entry names
 * must be unique and non-empty; duplicates would produce a confusing archive,
 * so they throw rather than silently shadow.
 */
export function buildZip(entries: ZipEntry[], dateIso: string): Uint8Array {
  const { date, time } = dosDateTime(dateIso);
  const seen = new Set<string>();
  const w = new ByteWriter();
  const central: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const name = entry.name.trim();
    if (name === "" || seen.has(name)) {
      throw new Error(`zip: duplicate or empty entry name "${name}"`);
    }
    seen.add(name);
    const nameBytes = encoder.encode(name);
    const body = toBytes(entry.data);
    const crc = crc32(body);
    const offset = w.length;

    w.u32(0x04034b50); // local file header
    w.u16(VERSION);
    w.u16(FLAG_UTF8);
    w.u16(METHOD_STORE);
    w.u16(time);
    w.u16(date);
    w.u32(crc);
    w.u32(body.length); // compressed size == raw size under STORE
    w.u32(body.length);
    w.u16(nameBytes.length);
    w.u16(0); // extra length
    w.bytes(nameBytes);
    w.bytes(body);

    central.push({ name: nameBytes, crc, size: body.length, offset });
  }

  const centralStart = w.length;
  for (const c of central) {
    w.u32(0x02014b50); // central directory header
    w.u16(VERSION); // version made by
    w.u16(VERSION); // version needed
    w.u16(FLAG_UTF8);
    w.u16(METHOD_STORE);
    w.u16(time);
    w.u16(date);
    w.u32(c.crc);
    w.u32(c.size);
    w.u32(c.size);
    w.u16(c.name.length);
    w.u16(0); // extra
    w.u16(0); // comment
    w.u16(0); // disk number start
    w.u16(0); // internal attrs
    w.u32(0); // external attrs
    w.u32(c.offset);
    w.bytes(c.name);
  }
  const centralSize = w.length - centralStart;

  w.u32(0x06054b50); // end of central directory
  w.u16(0); // this disk
  w.u16(0); // central dir disk
  w.u16(central.length);
  w.u16(central.length);
  w.u32(centralSize);
  w.u32(centralStart);
  w.u16(0); // comment length

  return w.concat();
}
