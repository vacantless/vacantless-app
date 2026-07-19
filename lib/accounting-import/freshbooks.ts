export type LedgerRow = {
  rowNo: number;
  date: string;
  amountCents: number;
  direction: "debit" | "credit";
  description: string | null;
  sourceCategory: string | null;
  clientTag: string | null;
};

export type FreshbooksParseResult =
  | {
      ok: true;
      rows: LedgerRow[];
      totalRows: number;
      skipped: number;
      columns: string[];
    }
  | {
      ok: false;
      reason: "not_csv" | "no_header" | "missing_columns" | "no_rows";
      columns?: string[];
    };

type ColumnKey = "date" | "amount" | "description" | "category" | "client" | "type" | "debit" | "credit";

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  date: ["date", "transaction date", "issue date"],
  amount: ["amount", "total", "grand total"],
  description: ["description", "notes", "vendor", "merchant", "client name"],
  category: ["category", "expense category", "account"],
  client: ["client", "project", "property"],
  type: ["type", "transaction type", "entry type"],
  debit: ["debit"],
  credit: ["credit"],
};

function normHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cell(row: string[], index: number | null): string | null {
  if (index == null) return null;
  const v = (row[index] ?? "").trim();
  return v === "" ? null : v;
}

function csvRows(content: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const text = content.replace(/^\ufeff/, "");

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
    } else {
      field += ch;
    }
  }

  if (inQuotes) return null;
  if (field !== "" || row.length > 0 || text.endsWith(",")) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function findColumn(columns: string[], key: ColumnKey): number | null {
  const wanted = new Set(HEADER_ALIASES[key].map(normHeader));
  const idx = columns.findIndex((name) => wanted.has(normHeader(name)));
  return idx >= 0 ? idx : null;
}

function validIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || month < 1 || month > 12) return null;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseDate(raw: string | null): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;

  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(v);
  if (m) return validIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(v);
  if (m) {
    const first = Number(m[1]);
    const second = Number(m[2]);
    const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
    // FreshBooks exports in this lane are North American. If the first value is
    // impossible as a month, treat it as day-first; otherwise month-first.
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    return validIsoDate(year, month, day);
  }

  const parsed = new Date(`${v} UTC`);
  if (Number.isNaN(parsed.getTime())) return null;
  return validIsoDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

type MoneyParse = {
  amountCents: number;
  sign: -1 | 0 | 1;
  marker: "debit" | "credit" | null;
};

function parseMoney(raw: string | null): MoneyParse | null {
  let v = (raw ?? "").trim();
  if (!v || /^[-\s]+$/.test(v)) return null;

  let marker: MoneyParse["marker"] = null;
  if (/\bcr\.?$/i.test(v)) {
    marker = "credit";
    v = v.replace(/\bcr\.?$/i, "").trim();
  } else if (/\bdr\.?$/i.test(v)) {
    marker = "debit";
    v = v.replace(/\bdr\.?$/i, "").trim();
  }

  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  v = v
    .replace(/\b(cad|usd)\b/gi, "")
    .replace(/[,$\s]/g, "")
    .replace(/^\+/, "");
  if (v.startsWith("-")) {
    negative = true;
    v = v.slice(1);
  } else if (v.endsWith("-")) {
    negative = true;
    v = v.slice(0, -1);
  }
  if (!/^\d+(?:\.\d+)?$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const amountCents = Math.round(n * 100);
  const sign = amountCents === 0 ? 0 : negative ? -1 : 1;
  return { amountCents, sign, marker };
}

function typeDirection(raw: string | null): "debit" | "credit" | null {
  const s = (raw ?? "").toLowerCase();
  if (!s) return null;
  if (/\b(credit|income|payment|deposit|receipt|sale|sales|rent|revenue)\b/.test(s)) return "credit";
  if (/\b(debit|expense|bill|purchase|charge|vendor)\b/.test(s)) return "debit";
  return null;
}

function amountAndDirection(row: string[], idx: Record<ColumnKey, number | null>): {
  amountCents: number;
  direction: "debit" | "credit";
} | null {
  const debit = parseMoney(cell(row, idx.debit));
  const credit = parseMoney(cell(row, idx.credit));
  const amount = parseMoney(cell(row, idx.amount));
  const type = typeDirection(cell(row, idx.type));

  if (credit && credit.amountCents > 0 && (!debit || debit.amountCents === 0)) {
    return { amountCents: credit.amountCents, direction: "credit" };
  }
  if (debit && debit.amountCents > 0 && (!credit || credit.amountCents === 0)) {
    return { amountCents: debit.amountCents, direction: "debit" };
  }
  if (!amount) return null;

  // Direction precedence: explicit Type/Debit/Credit columns win; then
  // accounting suffixes like CR/DR; then signed amount. With no signal, a
  // FreshBooks expense export is assumed to be money out.
  const direction =
    type ??
    amount.marker ??
    (amount.sign < 0 ? "debit" : "debit");
  return { amountCents: amount.amountCents, direction };
}

export function parseFreshbooksCsv(content: string): FreshbooksParseResult {
  const parsed = csvRows(content);
  if (!parsed) return { ok: false, reason: "not_csv" };

  const headerRowIndex = parsed.findIndex((row) => row.some((value) => value.trim() !== ""));
  if (headerRowIndex < 0) return { ok: false, reason: "no_header" };

  const columns = parsed[headerRowIndex].map((value, index) => {
    const trimmed = value.trim();
    return index === 0 ? trimmed.replace(/^\ufeff/, "") : trimmed;
  });
  const idx: Record<ColumnKey, number | null> = {
    date: findColumn(columns, "date"),
    amount: findColumn(columns, "amount"),
    description: findColumn(columns, "description"),
    category: findColumn(columns, "category"),
    client: findColumn(columns, "client"),
    type: findColumn(columns, "type"),
    debit: findColumn(columns, "debit"),
    credit: findColumn(columns, "credit"),
  };
  if (idx.date == null || idx.category == null || (idx.amount == null && idx.debit == null && idx.credit == null)) {
    return { ok: false, reason: "missing_columns", columns };
  }

  const rows: LedgerRow[] = [];
  let skipped = 0;
  const dataRows = parsed.slice(headerRowIndex + 1);
  for (let i = 0; i < dataRows.length; i += 1) {
    const row = dataRows[i];
    if (row.every((value) => value.trim() === "")) {
      skipped += 1;
      continue;
    }

    const date = parseDate(cell(row, idx.date));
    const amount = amountAndDirection(row, idx);
    if (!date || !amount) {
      skipped += 1;
      continue;
    }

    rows.push({
      rowNo: headerRowIndex + i + 2,
      date,
      amountCents: amount.amountCents,
      direction: amount.direction,
      description: cell(row, idx.description),
      sourceCategory: cell(row, idx.category),
      clientTag: cell(row, idx.client),
    });
  }

  if (rows.length === 0) return { ok: false, reason: "no_rows", columns };
  return { ok: true, rows, totalRows: dataRows.length, skipped, columns };
}
