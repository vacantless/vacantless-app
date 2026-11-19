// S820a: "Did you mean gmail.com?" for renter emails.
//
// Victor (Agile, 1551 Assumption Unit 9, 2026-11-19) typed
// "chidoh381@gmail.comc" on the inquiry form; the auto-reply bounced and he
// never heard back. suggestEmailFix catches the common slips on the big
// mailbox domains Canadian renters use and returns the fixed address, or
// null when the address looks fine or is not close to a known domain.
// Pure: no network, no DNS.

export const COMMON_EMAIL_DOMAINS = [
  "gmail.com",
  "hotmail.com",
  "hotmail.ca",
  "outlook.com",
  "live.com",
  "live.ca",
  "yahoo.com",
  "yahoo.ca",
  "icloud.com",
  "me.com",
  "msn.com",
  "aol.com",
  "rogers.com",
  "bell.net",
  "sympatico.ca",
  "shaw.ca",
  "telus.net",
  "cogeco.ca",
  "protonmail.com",
] as const;

// Real mailbox domains that sit one letter from a common one ("mail.com" vs
// "gmail.com"): never "fix" these.
const ALSO_REAL = ["ymail.com", "mail.com", "email.com", "gmx.com", "gmx.ca", "hey.com", "mac.com", "outlook.ca", "rocketmail.com", "zoho.com", "fastmail.com", "inbox.com", "yandex.com", "tutanota.com", "pm.me"];

const KNOWN = new Set<string>(COMMON_EMAIL_DOMAINS);
const FINE = new Set<string>([...COMMON_EMAIL_DOMAINS, ...ALSO_REAL]);

// Mistyped endings: "comc", "con", "cpm" and friends all mean ".com".
const TLD_FIXES: Record<string, string> = {
  comc: "com", comm: "com", con: "com", cmo: "com", cpm: "com", cim: "com", vom: "com", xom: "com",
  cm: "com", om: "com", co: "com", coom: "com", ocm: "com", "com.": "com", cc: "ca", caa: "ca", ac: "ca",
  nett: "net", ner: "net", nte: "net",
};

function distance(a: string, b: string): number {
  // Damerau-Levenshtein (optimal string alignment): a swap counts as one slip.
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The fixed address when `raw` looks like a slip on a common domain, else null. */
export function suggestEmailFix(raw: string | null | undefined): string | null {
  const email = (raw ?? "").trim().toLowerCase().replace(/[.,;]+$/, "");
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const typed = email.slice(at + 1);
  if (FINE.has(typed)) return null;
  let domain = typed.replace(/\.{2,}/g, ".");
  if (KNOWN.has(domain)) return `${local}@${domain}`;

  // "gmailcom", "gmail" (no dot or no ending).
  for (const k of COMMON_EMAIL_DOMAINS) {
    const name = k.split(".")[0];
    if (domain === k.replace(".", "") || (domain === name && name.length >= 5)) return `${local}@${k}`;
  }

  const dot = domain.lastIndexOf(".");
  if (dot > 0) {
    const name = domain.slice(0, dot);
    const tld = domain.slice(dot + 1);
    const fixedTld = TLD_FIXES[tld];
    if (fixedTld && KNOWN.has(`${name}.${fixedTld}`)) return `${local}@${name}.${fixedTld}`;
    if (fixedTld) domain = `${name}.${fixedTld}`;
  }
  if (KNOWN.has(domain)) return `${local}@${domain}`;

  // Closest known domain, one or two slips away ("gmial.com", "hotmal.com").
  let best: string | null = null;
  let bestD = Infinity;
  for (const k of COMMON_EMAIL_DOMAINS) {
    const dd = distance(domain, k);
    if (dd < bestD) { bestD = dd; best = k; }
  }
  const limit = domain.length >= 9 ? 2 : 1;
  if (best && bestD > 0 && bestD <= limit) return `${local}@${best}`;
  return null;
}
