/**
 * Redaction of personal data before letter text leaves the browser.
 *
 * Rules find structured identifiers (IBAN, e-mail, phone, birth date, case and customer
 * numbers) and the values of the user's profile (name, address). There is no machine
 * recognition of names, which is why the preview also lets the user hide words by hand.
 * Each distinct value becomes a numbered placeholder such as `[IBAN_1]`; placeholders in
 * the model's answer are filled back in here, in the browser, and nowhere else.
 */

export type SensitiveKind =
  | "iban"
  | "email"
  | "phone"
  | "birthDate"
  | "caseNo"
  | "customerNo"
  | "bgNo"
  | "insuranceNo"
  | "taxId"
  | "name"
  | "address";

export interface SensitiveMatch {
  readonly start: number;
  readonly end: number;
  readonly kind: SensitiveKind;
}

/** Kept only in page memory; there is no storage yet. */
export interface Profile {
  readonly firstName: string;
  readonly lastName: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
}

export interface Redaction {
  readonly text: string;
  /** Placeholder → original text, for `restore`. */
  readonly originals: ReadonlyMap<string, string>;
}

const LABELS: Record<SensitiveKind, string> = {
  iban: "IBAN",
  email: "EMAIL",
  phone: "PHONE",
  birthDate: "BIRTH_DATE",
  caseNo: "CASE_NO",
  customerNo: "CUSTOMER_NO",
  bgNo: "BG_NO",
  insuranceNo: "INSURANCE_NO",
  taxId: "TAX_ID",
  name: "NAME",
  address: "ADDRESS",
};

// Decides between overlapping matches of equal length: the earlier kind wins. Anchored
// identifiers beat the phone rule because a number such as `0815/4711` after
// "Aktenzeichen" also looks like a phone number.
const PRIORITY: readonly SensitiveKind[] = [
  "iban",
  "email",
  "birthDate",
  "taxId",
  "insuranceNo",
  "bgNo",
  "customerNo",
  "caseNo",
  "name",
  "address",
  "phone",
];

// Patterns are built with the RegExp constructor: tsconfig targets ES2017, and TypeScript
// rejects lookbehind and `\p{…}` in regex literals for that target.
const NOT_WORD_BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const NOT_WORD_AFTER = String.raw`(?![\p{L}\p{N}])`;
// Horizontal whitespace, including the non-breaking spaces that PDFs paste.
const SPACE_CHARS = String.raw`\t \u00A0\u2000-\u200A\u202F\u205F\u3000`;
const SPACE = `[${SPACE_CHARS}]`;

const MONTHS =
  "Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember";
const DATE = String.raw`\d{1,2}\.${SPACE}?(?:\d{1,2}\.${SPACE}?(?:\d{4}|\d{2})|${SPACE}*(?:${MONTHS})${SPACE}+\d{4})`;

const IBAN_CANDIDATE = new RegExp(
  String.raw`${NOT_WORD_BEFORE}[A-Z]{2}\d{2}(?:${SPACE}?[A-Z0-9]){11,40}`,
  "gu",
);
const IBAN_MIN_LENGTH = 15;
const IBAN_MAX_LENGTH = 34;

const EMAIL = new RegExp(
  String.raw`[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)*\.\p{L}{2,}`,
  "gu",
);

// A dot is not a phone separator, so dates (01.12.2026) and amounts (1.234,56) never
// match. Numbers of the authority are redacted too; no extracted field needs them.
const PHONE = new RegExp(
  String.raw`(?<![\p{L}\p{N}+(])\(?(?:\+|0)[\d${SPACE_CHARS}/()\-]*\d`,
  "gu",
);
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 16;

// Only a date right after a birth keyword is redacted. Any other date may be the letter
// date or a deadline, and the deadline is the whole point of the app.
const BIRTH_DATE = new RegExp(
  String.raw`${NOT_WORD_BEFORE}(?:geb\.(?:${SPACE}*am)?|geboren(?:${SPACE}+am)?|Geburtsdatum|Geb\.-?Datum)${SPACE}*:?\s*(${DATE})(?!\d)`,
  "giud",
);

// Formats of case and customer numbers differ per authority, so most of them are found
// by the keyword before the value rather than by their shape.
const ANCHORS: readonly (readonly [SensitiveKind, string])[] = [
  [
    "caseNo",
    String.raw`Aktenzeichens?|Az\.?|Geschäftszeichens?|(?:Unser|Ihr)${SPACE}+Zeichen`,
  ],
  [
    "customerNo",
    String.raw`Kunden-?(?:nummer|nr\.?)|Beitragsnummer|Mitgliedsnummer`,
  ],
  [
    "bgNo",
    String.raw`BG-?(?:Nummer|Nr\.?)|Nummer${SPACE}+der${SPACE}+Bedarfsgemeinschaft`,
  ],
  [
    "insuranceNo",
    String.raw`(?:Renten|Sozial|Kranken)?versicherungsnummer|(?:Kranken)?versichertennummer|Versicherten-?Nr\.?`,
  ],
  [
    "taxId",
    String.raw`Steuer-?ID|Steuer-?identifikationsnummer|Identifikationsnummer|IdNr\.?|Steuernummer|St\.?-?Nr\.?`,
  ],
];
// After the keyword: an optional note in brackets ("(bitte stets angeben)"), an optional
// colon, and at most one line break, for values printed under their label.
const ANCHOR_SEPARATOR = String.raw`${SPACE}*(?:\([^)\n]{0,60}\)${SPACE}*)?[:#]?${SPACE}*(?:\n${SPACE}*)?`;
const ANCHOR_PATTERNS = ANCHORS.map(
  ([kind, keywords]) =>
    [
      kind,
      new RegExp(
        String.raw`${NOT_WORD_BEFORE}(?:${keywords})(?!\p{L})${ANCHOR_SEPARATOR}`,
        "giu",
      ),
    ] as const,
);
const IDENTIFIER_TOKEN = new RegExp(
  String.raw`^[\p{L}\p{N}][\p{L}\p{N}/.\-]*$`,
  "u",
);
// Short letter groups inside a number, as in `12 010280 M 123`.
const CONNECTOR_TOKEN = /^[A-Z]{1,3}$/;
const DATE_TOKEN = /^\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})$/;
const MAX_IDENTIFIER_TOKENS = 6;
const TOKEN = /\S+/y;
const TOKEN_GAP = /[^\S\n]+/y;

// Identifiers with a recognisable shape are redacted even without a keyword.
const FORMATS: readonly (readonly [SensitiveKind, RegExp])[] = [
  // Bedarfsgemeinschaft number of the Jobcenter: 12345BG0012345.
  [
    "bgNo",
    new RegExp(
      String.raw`${NOT_WORD_BEFORE}\d{5}${SPACE}?BG${SPACE}?\d{7}${NOT_WORD_AFTER}`,
      "gu",
    ),
  ],
  // Pension insurance number; its middle part is the birth date (DDMMYY).
  [
    "insuranceNo",
    new RegExp(
      String.raw`${NOT_WORD_BEFORE}\d{2}${SPACE}?(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}${SPACE}?[A-Z]${SPACE}?\d{3}${NOT_WORD_AFTER}`,
      "gu",
    ),
  ],
  // Health insurance number: one letter and nine digits.
  [
    "insuranceNo",
    new RegExp(String.raw`${NOT_WORD_BEFORE}[A-Z]\d{9}${NOT_WORD_AFTER}`, "gu"),
  ],
];
const TAX_ID_CANDIDATE = new RegExp(
  String.raw`${NOT_WORD_BEFORE}[1-9]\d${SPACE}?\d{3}${SPACE}?\d{3}${SPACE}?\d{3}${NOT_WORD_AFTER}`,
  "gu",
);

const STREET_SUFFIX = /stra(?:ß|ss)e$/i;
const STREET_WITH_NUMBER =
  /^(.*?)\s*(\d+\s*[a-z]?(?:\s*[-/]\s*\d+\s*[a-z]?)?)$/i;
const MIN_NAME_PART_LENGTH = 2;

// Letters pasted from different sources spell umlauts either way: "Müller", "Mueller".
const SPELLING_VARIANTS: Readonly<Partial<Record<string, string>>> = {
  ä: "(?:ä|ae)",
  ae: "(?:ä|ae)",
  ö: "(?:ö|oe)",
  oe: "(?:ö|oe)",
  ü: "(?:ü|ue)",
  ue: "(?:ü|ue)",
  ß: "(?:ß|ss)",
  ss: "(?:ß|ss)",
};
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

export function findSensitive(
  text: string,
  profile: Profile,
): SensitiveMatch[] {
  return resolveOverlaps([
    ...findIbans(text),
    ...findAll(text, EMAIL, "email"),
    ...findPhones(text),
    ...findBirthDates(text),
    ...findAnchoredIdentifiers(text),
    ...FORMATS.flatMap(([kind, pattern]) => findAll(text, pattern, kind)),
    ...findTaxIds(text),
    ...findProfileValues(text, profile),
  ]);
}

/**
 * Replaces each match with a placeholder. Equal values of one kind share a placeholder,
 * so the model sees that the same IBAN appears twice.
 */
export function redact(
  text: string,
  matches: readonly SensitiveMatch[],
): Redaction {
  const ordered = [...matches].sort((a, b) => a.start - b.start);
  const labels = new Map<string, string>();
  const originals = new Map<string, string>();
  const counters = new Map<SensitiveKind, number>();
  let result = "";
  let cursor = 0;

  for (const match of ordered) {
    if (match.start < cursor) {
      throw new Error("Redaction matches must not overlap.");
    }
    const value = text.slice(match.start, match.end);
    const key = `${match.kind}\u0000${value}`;
    let label = labels.get(key);
    if (label === undefined) {
      const count = (counters.get(match.kind) ?? 0) + 1;
      counters.set(match.kind, count);
      label = `[${LABELS[match.kind]}_${String(count)}]`;
      labels.set(key, label);
      originals.set(label, value);
    }
    result += text.slice(cursor, match.start) + label;
    cursor = match.end;
  }

  return { text: result + text.slice(cursor), originals };
}

/** Fills placeholders back in. A placeholder the model invented stays as it is. */
export function restore(
  answer: string,
  originals: ReadonlyMap<string, string>,
): string {
  return answer.replace(
    /\[[A-Z_]+_\d+\]/g,
    (label) => originals.get(label) ?? label,
  );
}

function findAll(
  text: string,
  pattern: RegExp,
  kind: SensitiveKind,
): SensitiveMatch[] {
  return Array.from(text.matchAll(pattern), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
    kind,
  }));
}

// Longest match wins, so a full name beats the surname inside it and an IBAN beats the
// phone-like digit groups inside it.
function resolveOverlaps(candidates: SensitiveMatch[]): SensitiveMatch[] {
  const byStrength = [...candidates].sort(
    (a, b) =>
      b.end - b.start - (a.end - a.start) ||
      PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind) ||
      a.start - b.start,
  );
  const chosen: SensitiveMatch[] = [];
  for (const candidate of byStrength) {
    if (
      !chosen.some(
        (other) => candidate.start < other.end && other.start < candidate.end,
      )
    ) {
      chosen.push(candidate);
    }
  }
  return chosen.sort((a, b) => a.start - b.start);
}

// The candidate pattern is greedy and may run into a following "BIC", so the longest
// prefix that ends between digit groups and passes the checksum is taken.
function findIbans(text: string): SensitiveMatch[] {
  const matches: SensitiveMatch[] = [];
  for (const candidate of text.matchAll(IBAN_CANDIDATE)) {
    const raw = candidate[0];
    const charEnds: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (!/\s/.test(raw.charAt(i))) charEnds.push(i + 1);
    }
    const end = charEnds
      .slice(IBAN_MIN_LENGTH - 1, IBAN_MAX_LENGTH)
      .reverse()
      .find(
        (end) =>
          (end === raw.length || /\s/.test(raw.charAt(end))) &&
          ibanChecksumValid(raw.slice(0, end)),
      );
    if (end !== undefined) {
      matches.push({
        start: candidate.index,
        end: candidate.index + end,
        kind: "iban",
      });
    }
  }
  return matches;
}

function ibanChecksumValid(iban: string): boolean {
  const compact = iban.replace(/\s/g, "");
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = Number.parseInt(char, 36);
    remainder = (remainder * (value < 10 ? 10 : 100) + value) % 97;
  }
  return remainder === 1;
}

function findPhones(text: string): SensitiveMatch[] {
  return findAll(text, PHONE, "phone").filter((match) => {
    const digits = text.slice(match.start, match.end).replace(/\D/g, "").length;
    return digits >= PHONE_MIN_DIGITS && digits <= PHONE_MAX_DIGITS;
  });
}

function findBirthDates(text: string): SensitiveMatch[] {
  return Array.from(text.matchAll(BIRTH_DATE)).flatMap((match) => {
    const date = match.indices?.[1];
    return date ? [{ start: date[0], end: date[1], kind: "birthDate" }] : [];
  });
}

function findAnchoredIdentifiers(text: string): SensitiveMatch[] {
  return ANCHOR_PATTERNS.flatMap(([kind, pattern]) =>
    Array.from(text.matchAll(pattern)).flatMap((anchor) => {
      const start = anchor.index + anchor[0].length;
      const end = scanIdentifier(text, start);
      return end > start ? [{ start, end, kind }] : [];
    }),
  );
}

/**
 * Returns the end of the identifier that starts at `from`: words on the same line that
 * contain a digit, until the first word without one. Dates are never taken, so a
 * "Datum: 01.12.2026" column next to the number stays.
 */
function scanIdentifier(text: string, from: number): number {
  let end = from;
  let position = from;
  for (let count = 0; count < MAX_IDENTIFIER_TOKENS; count++) {
    TOKEN.lastIndex = position;
    const token = TOKEN.exec(text);
    if (!token) break;
    const raw = token[0];
    const word = raw.replace(/[.,;:)]+$/, "");
    const endsSentence = word.length < raw.length;

    if (
      IDENTIFIER_TOKEN.test(word) &&
      /\d/.test(word) &&
      !DATE_TOKEN.test(word)
    ) {
      end = token.index + word.length;
    } else if (!(end > from && !endsSentence && CONNECTOR_TOKEN.test(word))) {
      break;
    }
    if (endsSentence) break;

    TOKEN_GAP.lastIndex = token.index + raw.length;
    if (!TOKEN_GAP.exec(text)) break;
    position = TOKEN_GAP.lastIndex;
  }
  return end;
}

function findTaxIds(text: string): SensitiveMatch[] {
  return findAll(text, TAX_ID_CANDIDATE, "taxId").filter((match) =>
    taxIdChecksumValid(text.slice(match.start, match.end).replace(/\s/g, "")),
  );
}

// Check digit of the Steuer-ID: ISO 7064, MOD 11,10.
function taxIdChecksumValid(id: string): boolean {
  let product = 10;
  for (const char of id.slice(0, 10)) {
    const sum = (Number(char) + product) % 10 || 10;
    product = (sum * 2) % 11;
  }
  const check = (11 - product) % 10;
  return check === Number(id.charAt(10));
}

function findProfileValues(text: string, profile: Profile): SensitiveMatch[] {
  const names = namePatterns(profile.firstName, profile.lastName);
  const addresses = [
    streetPattern(profile.street),
    postalCodePattern(profile.postalCode, profile.city),
  ].filter((pattern) => pattern !== undefined);

  return [
    ...names.flatMap((pattern) => findAll(text, pattern, "name")),
    ...addresses.flatMap((pattern) => findAll(text, pattern, "address")),
  ];
}

// Letters address people as "Max Mustermann", "Mustermann, Max", "Herr Mustermann" or
// just "Max", so every form is searched; the longest one wins in `resolveOverlaps`.
function namePatterns(firstName: string, lastName: string): RegExp[] {
  const first = firstName.trim();
  const last = lastName.trim();
  const sources: string[] = [];

  if (first && last) {
    sources.push(`${flexible(first)}\\s+${flexible(last)}`);
    sources.push(`${flexible(last)}\\s*,\\s*${flexible(first)}`);
  }
  if (last.length >= MIN_NAME_PART_LENGTH) sources.push(flexible(last));
  if (first.length >= MIN_NAME_PART_LENGTH) sources.push(flexible(first));
  // Only first names are split: a surname such as "von Weizsäcker" would otherwise
  // redact every "von" in the letter.
  const firstParts = first.split(/[\s-]+/);
  if (firstParts.length > 1) {
    for (const part of firstParts) {
      if (part.length >= MIN_NAME_PART_LENGTH) sources.push(flexible(part));
    }
  }

  return sources.map(
    (source) =>
      new RegExp(`${NOT_WORD_BEFORE}${source}${NOT_WORD_AFTER}`, "giu"),
  );
}

function streetPattern(street: string): RegExp | undefined {
  const trimmed = street.trim();
  const parts = STREET_WITH_NUMBER.exec(trimmed);
  const name = parts ? parts[1] : trimmed;
  const houseNumber = parts ? parts[2] : undefined;
  if (!name) return undefined;

  const suffix = STREET_SUFFIX.exec(name);
  const namePattern = suffix
    ? `${flexible(name.slice(0, suffix.index))}(?:stra(?:ß|ss)e|str\\.)`
    : flexible(name);
  const numberPattern = houseNumber
    ? `${SPACE}*${houseNumber
        .replace(/\s/g, "")
        .split("")
        .map(escapeRegex)
        .join("\\s*")}`
    : "";

  return new RegExp(
    `${NOT_WORD_BEFORE}${namePattern}${numberPattern}(?!\\p{N})`,
    "giu",
  );
}

// The city alone is not redacted: it is usually also the city of the authority
// ("Jobcenter Musterstadt"), and the sender is one of the fields to extract.
function postalCodePattern(
  postalCode: string,
  city: string,
): RegExp | undefined {
  const code = postalCode.trim();
  const town = city.trim();
  if (!code || !town) return undefined;
  return new RegExp(
    `${NOT_WORD_BEFORE}${escapeRegex(code)}\\s+${flexible(town)}${NOT_WORD_AFTER}`,
    "giu",
  );
}

/**
 * Pattern for a profile value as letters spell it: any case, any whitespace, either
 * umlaut spelling, and soft hyphens that PDFs leave inside words.
 */
function flexible(value: string): string {
  const units: string[] = [];
  let i = 0;
  while (i < value.length) {
    const char = value.charAt(i);
    const pairVariant = SPELLING_VARIANTS[value.slice(i, i + 2).toLowerCase()];
    if (/\s/.test(char)) {
      while (/\s/.test(value.charAt(i))) i++;
      units.push("\\s+");
    } else if (char === "-") {
      units.push("\\s*-\\s*");
      i++;
    } else if (pairVariant !== undefined) {
      units.push(pairVariant);
      i += 2;
    } else {
      units.push(SPELLING_VARIANTS[char.toLowerCase()] ?? escapeRegex(char));
      i++;
    }
  }
  return units.join("\\u00AD?");
}

function escapeRegex(value: string): string {
  return value.replace(REGEX_SYNTAX, "\\$&");
}
