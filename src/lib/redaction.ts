/**
 * Redaction of personal data before letter text leaves the browser.
 *
 * Rules find structured identifiers (IBAN, e-mail, phone, birth date, case and customer
 * numbers). The recipient's name and address are read from the address block and the
 * salutation and then searched for in the whole letter, so the user does not have to
 * type them in. There is no machine recognition of names, and these heuristics miss
 * some letters, which is why the preview also lets the user hide words by hand.
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

/** Name and address of a recipient, as read from the letter. */
interface Profile {
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

// A dot is not a phone separator, so dotted dates (01.12.2026) and amounts (1.234,56)
// never match; dates with slashes or hyphens are dropped in `findPhones`. Numbers of the
// authority are redacted too; no extracted field needs them.
const PHONE = new RegExp(
  String.raw`(?<![\p{L}\p{N}+(])\(?(?:\+|0)[\d${SPACE_CHARS}/()\-]*\d`,
  "gu",
);
const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 16;

// Day, separator, month, the same separator, year: 01.12.2026, 01/12/2026, 03-12-26.
const DATE_SHAPE = new RegExp(
  String.raw`(?<!\d)(\d{1,2})([./\-])(\d{1,2})\2(?:\d{4}|\d{2})(?!\d)`,
  "gu",
);

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

// The profile may hold the street in full or abbreviated; the letter may use either.
const STREET_SUFFIX = /(?:stra(?:ß|ss)e|str\.?)$/i;
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

export function findSensitive(text: string): SensitiveMatch[] {
  const blocks = findAddressBlocks(text);
  const profiles = [...blocks.profiles, ...findSalutationNames(text)];
  return resolveOverlaps([
    ...findIbans(text),
    ...findAll(text, EMAIL, "email"),
    ...findPhones(text),
    ...findBirthDates(text),
    ...findAnchoredIdentifiers(text),
    ...FORMATS.flatMap(([kind, pattern]) => findAll(text, pattern, kind)),
    ...findTaxIds(text),
    ...blocks.addresses,
    ...profiles.flatMap((profile) => findProfileValues(text, profile)),
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

// Address block of the recipient (DIN 5008) and the salutation. The postal code with its
// city is the anchor: it starts a line or follows a separator, as in the return address
// line "Jobcenter Musterstadt · Postfach 10 20 30 · 12340 Musterstadt", or it follows the
// house number when a pasted block lost its line breaks.
const CITY_WORD = String.raw`\p{Lu}[\p{L}\-]*`;
const CITY = String.raw`(?:(?:Bad|St\.|Sankt|Groß|Klein|Neu|Alt)${SPACE}+)?${CITY_WORD}(?:${SPACE}*\(${CITY_WORD}\)|${SPACE}*\/${SPACE}*${CITY_WORD}|${SPACE}+(?:am|an${SPACE}+der|im|in|ob${SPACE}+der|bei|a\.${SPACE}?d\.|a\.|i\.)${SPACE}*${CITY_WORD})?`;
const POSTAL_CODE_CITY = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:D-?${SPACE}?)?(\d{5})(?!\p{N})${SPACE}+(${CITY})(?![\p{L}\p{N}])`,
  "gu",
);
const NOT_A_CITY: ReadonlySet<string> = new Set(["Euro", "EUR"]);
const SEPARATOR = new RegExp(
  String.raw`[,;·•|–\t]|${SPACE}-${SPACE}|${SPACE}{2,}`,
  "gu",
);
const SEPARATOR_AT_END = new RegExp(
  String.raw`(?:[,;·•|–\t]|${SPACE}-|${SPACE}{2})${SPACE}*$`,
  "u",
);
const HOUSE_NUMBER_AT_END = new RegExp(
  String.raw`(?<![\p{L}\p{N}])\d{1,4}${SPACE}?[a-zA-Z]?(?:${SPACE}?[-/]${SPACE}?\d{1,4}${SPACE}?[a-zA-Z]?)?$`,
  "u",
);
const POST_BOX = new RegExp(
  String.raw`^Postfach${SPACE}+\d[\d${SPACE_CHARS}]*$`,
  "u",
);
const STREET_TOKEN = /^(?:\p{Lu}[\p{L}.\-]*|[\p{Ll}]+|&)$/u;
// "Berliner Straße 5": the street word alone needs the word before it.
const STREET_WORD =
  /^(?:Straße|Strasse|Str\.?|Weg|Allee|Platz|Ring|Damm|Ufer|Chaussee|Gasse|Steig|Pfad|Markt)$/u;
// "Am Markt 3", "An der Kirche 7", "Unter den Linden 5".
const STREET_PREPOSITION =
  /^(?:Am|Im|An|Auf|In|Zum|Zur|Unter|Hinter|Vor|Beim|Über)$/u;
const STREET_ARTICLE = /^(?:der|den|dem|des)$/u;
const MAX_STREET_WORDS = 5;

const SALUTATION = new RegExp(
  String.raw`(?<!\p{L})(?:sehr${SPACE}+geehrte[rn]?|guten${SPACE}+tag|liebe[rn]?|hallo)(?!\p{L})`,
  "giu",
);
// With "Frau" or "Herr", a single word is the surname; "Familie" and "Eheleute" stand
// before a list of first names that share the surname at the end.
const PERSONAL_FORMS: ReadonlySet<string> = new Set(["Frau", "Herr", "Herrn"]);
const COLLECTIVE_FORMS: ReadonlySet<string> = new Set(["Familie", "Eheleute"]);
const ACADEMIC_TITLE =
  /^(?:Dr\.|Prof\.|Dr\.-\p{L}+\.|Dipl\.-\p{L}+\.|med\.|jur\.|rer\.|nat\.|phil\.)$/u;
const NAME_WORD = /^\p{Lu}[\p{L}'’]*(?:-\p{L}[\p{L}'’]*)*$/u;
const NAME_PARTICLE =
  /^(?:von|vom|van|de|der|den|del|della|di|da|du|la|le|zu|zur|ten|ter|al|el|bin)$/u;
const CONJUNCTION = /^(?:und|u\.|&)$/u;
const MAX_NAME_WORDS = 4;
// Words that mark the sender rather than a person: "Jobcenter Musterstadt",
// "Deutsche Rentenversicherung", "Familienkasse".
const ORGANISATION_WORDS: ReadonlySet<string> = new Set([
  "jobcenter",
  "agentur",
  "gmbh",
  "ag",
  "kg",
  "e.v.",
  "gemeinde",
  "landkreis",
  "kreis",
  "bezirk",
  "senat",
  "polizei",
  "team",
  "referat",
  "abteilung",
  "deutsche",
  "deutscher",
  "stadt",
  "freie",
  "postfach",
]);
const ORGANISATION_SUFFIXES = [
  "amt",
  "behörde",
  "kasse",
  "gericht",
  "bank",
  "zentrum",
  "center",
  "versicherung",
  "verwaltung",
  "service",
  "ministerium",
  "regierung",
  "präsidium",
  "schule",
  "universität",
  "büro",
  "stelle",
  "stadt",
] as const;
// A surname such as "Mai" would otherwise redact "1. Mai 2026", which may be the deadline.
const CALENDAR_WORDS: ReadonlySet<string> = new Set(
  [
    ...MONTHS.split("|"),
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonnabend",
    "Sonntag",
  ].map((word) => word.toLowerCase()),
);

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
    const value = text.slice(match.start, match.end);
    const digits = value.replace(/\D/g, "").length;
    return (
      digits >= PHONE_MIN_DIGITS &&
      digits <= PHONE_MAX_DIGITS &&
      !containsDate(value)
    );
  });
}

// A date may be the letter date or a deadline, so nothing that contains one is
// redacted, except after a birth keyword.
function containsDate(value: string): boolean {
  return Array.from(value.matchAll(DATE_SHAPE)).some((match) => {
    const day = Number(match[1]);
    const month = Number(match[3]);
    return day >= 1 && day <= 31 && month >= 1 && month <= 12;
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

    if (IDENTIFIER_TOKEN.test(word) && /\d/.test(word) && !containsDate(word)) {
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
    ? `${flexible(name.slice(0, suffix.index))}(?:stra(?:ß|ss)e|str\\.?)`
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

interface Span {
  readonly start: number;
  readonly end: number;
}

interface Person {
  readonly firstName: string;
  readonly lastName: string;
}

/**
 * Finds postal codes with their city, the street before them and the recipient's name
 * before the street. Every such address is redacted where it stands, the authority's own
 * included; only blocks with a person's name become profiles that are searched for in
 * the whole letter.
 */
function findAddressBlocks(text: string): {
  addresses: SensitiveMatch[];
  profiles: Profile[];
} {
  const addresses: SensitiveMatch[] = [];
  const profiles: Profile[] = [];

  for (const match of text.matchAll(POSTAL_CODE_CITY)) {
    const [whole, postalCode, city] = match;
    if (NOT_A_CITY.has(city)) continue;

    const lineStart = lineStartOf(text, match.index);
    const head = text.slice(lineStart, match.index);
    let streetLine: Span | undefined;
    if (head.trim() === "") {
      streetLine = previousLine(text, lineStart);
    } else if (
      SEPARATOR_AT_END.test(head) ||
      HOUSE_NUMBER_AT_END.test(head.trimEnd())
    ) {
      streetLine = { start: lineStart, end: match.index };
    } else {
      // A postal code in the middle of a sentence is not an address line.
      continue;
    }
    addresses.push({
      start: match.index,
      end: match.index + whole.length,
      kind: "address",
    });

    if (streetLine === undefined) continue;
    const parts = splitParts(text, streetLine);
    const streetPart = parts.at(-1);
    if (streetPart === undefined) continue;
    const street = splitStreet(text.slice(streetPart.start, streetPart.end));
    if (street === undefined) continue;
    const streetStart = streetPart.start + street.start;
    addresses.push({
      start: streetStart,
      end: streetPart.end,
      kind: "address",
    });

    const namePart = parts.at(-2);
    let persons = street.persons;
    if (persons.length === 0) {
      persons = namePart
        ? parsePersons(text.slice(namePart.start, namePart.end))
        : personsAbove(text, streetLine.start);
    }
    for (const person of persons) {
      profiles.push({
        ...person,
        street: text.slice(streetStart, streetPart.end),
        postalCode,
        city,
      });
    }
  }

  return { addresses, profiles };
}

/** Surnames from "Sehr geehrte Frau Müller," and the like. */
function findSalutationNames(text: string): Profile[] {
  return Array.from(text.matchAll(SALUTATION)).flatMap((match) => {
    const from = match.index + match[0].length;
    const lineEnd = text.indexOf("\n", from);
    const rest = text.slice(from, lineEnd === -1 ? text.length : lineEnd);
    const words: string[] = [];
    for (const word of rest.split(/[,!:]/)[0]?.split(/\s+/) ?? []) {
      if (word === "") continue;
      if (!isNameToken(word)) break;
      words.push(word);
    }
    while (words.length > 0 && CONJUNCTION.test(words.at(-1) ?? "")) {
      words.pop();
    }
    return parsePersons(words.join(" "), { requireForm: true }).map(
      (person) => ({ ...person, street: "", postalCode: "", city: "" }),
    );
  });
}

/**
 * Splits a street part such as "Frau Anna Müller Lindenstraße 5" into the street and the
 * name before it. Returns undefined if the part does not end with a house number.
 */
function splitStreet(
  part: string,
): { start: number; persons: Person[] } | undefined {
  if (POST_BOX.test(part)) return { start: 0, persons: [] };
  const houseNumber = HOUSE_NUMBER_AT_END.exec(part);
  if (!houseNumber) return undefined;
  const words = Array.from(part.slice(0, houseNumber.index).matchAll(/\S+/g));
  if (words.length === 0) return undefined;
  if (!words.every((word) => STREET_TOKEN.test(word[0]))) return undefined;

  let first = words.length - 1;
  if (STREET_WORD.test(words[first]?.[0] ?? "") && first > 0) first--;
  for (let i = first - 1; i >= Math.max(0, first - 3); i--) {
    const word = words[i]?.[0] ?? "";
    if (STREET_PREPOSITION.test(word)) {
      first = i;
      break;
    }
    if (!STREET_ARTICLE.test(word) && !NAME_WORD.test(word)) break;
  }

  const streetStart = words[first]?.index ?? 0;
  if (first === 0) return { start: 0, persons: [] };
  const prefix = part.slice(0, streetStart);
  const persons = parsePersons(prefix);
  if (persons.length > 0) return { start: streetStart, persons };
  // Capitalised words before the street that are no name, as in "Alte Dorfstraße 3",
  // belong to the street, unless they name the authority: its name is one of the fields
  // to extract. A sentence ("wohnen in der Musterstraße 12") does not.
  const prefixWords = prefix.split(/\s+/).filter((word) => word !== "");
  const wholePart =
    words.length <= MAX_STREET_WORDS &&
    prefixWords.every(
      (word) => NAME_WORD.test(word) || STREET_ARTICLE.test(word),
    ) &&
    !prefixWords.some(isOrganisationWord);
  return { start: wholePart ? 0 : streetStart, persons: [] };
}

/**
 * The name on the line above the street; "Frau" or "Herrn" may stand on a line of its
 * own above that.
 */
function personsAbove(text: string, lineStart: number): Person[] {
  const nameLine = previousLine(text, lineStart);
  if (nameLine === undefined) return [];
  const formLine = previousLine(text, nameLine.start);
  const formAbove =
    formLine !== undefined &&
    PERSONAL_FORMS.has(text.slice(formLine.start, formLine.end).trim());
  return parsePersons(text.slice(nameLine.start, nameLine.end), { formAbove });
}

/**
 * Reads "Frau Dr. Anna Müller", "Anna und Max Müller" or "Familie von Muster" as people.
 * Without "Frau" or "Herr", at least first name and surname are needed, so a single
 * capitalised word is not taken for a name. Returns no one if any word does not fit.
 */
function parsePersons(
  text: string,
  options: { formAbove?: boolean; requireForm?: boolean } = {},
): Person[] {
  let group: { words: string[]; personal: boolean } = {
    words: [],
    personal: options.formAbove ?? false,
  };
  const groups = [group];
  let hasForm = options.formAbove ?? false;
  let wordCount = 0;

  for (const word of text.split(/\s+/)) {
    if (word === "") continue;
    if (CONJUNCTION.test(word)) {
      if (group.words.length === 0) return [];
      group = { words: [], personal: false };
      groups.push(group);
    } else if (PERSONAL_FORMS.has(word)) {
      hasForm = true;
      group.personal = true;
    } else if (COLLECTIVE_FORMS.has(word)) {
      hasForm = true;
    } else if (ACADEMIC_TITLE.test(word)) {
      continue;
    } else if (
      (NAME_WORD.test(word) || NAME_PARTICLE.test(word)) &&
      !isOrganisationWord(word)
    ) {
      group.words.push(word);
      wordCount++;
    } else {
      return [];
    }
  }

  if (options.requireForm && !hasForm) return [];
  if (!hasForm && wordCount < 2) return [];
  if (groups.some((group) => group.words.length === 0)) return [];
  if (groups.some((group) => group.words.length > MAX_NAME_WORDS)) return [];

  const named = groups.map(({ words, personal }, index) => {
    const isLast = index === groups.length - 1;
    const particle = words.findIndex(
      (word, i) => i > 0 && NAME_PARTICLE.test(word),
    );
    if (particle > 0) {
      return {
        firstName: words.slice(0, particle).join(" "),
        lastName: words.slice(particle).join(" "),
      };
    }
    if (words.length === 1) {
      const word = words[0] ?? "";
      return personal || isLast
        ? { firstName: "", lastName: word }
        : { firstName: word, lastName: "" };
    }
    return {
      firstName: words.slice(0, -1).join(" "),
      lastName: words.at(-1) ?? "",
    };
  });

  const sharedSurname = named.at(-1)?.lastName ?? "";
  return named.map((person) =>
    withoutCalendarWords({
      firstName: person.firstName,
      lastName: person.lastName || sharedSurname,
    }),
  );
}

function withoutCalendarWords(person: Person): Person {
  const isCalendar = (word: string) => CALENDAR_WORDS.has(word.toLowerCase());
  return {
    firstName: person.firstName
      .split(" ")
      .filter((word) => !isCalendar(word))
      .join(" "),
    lastName: isCalendar(person.lastName) ? "" : person.lastName,
  };
}

function isNameToken(word: string): boolean {
  return (
    NAME_WORD.test(word) ||
    NAME_PARTICLE.test(word) ||
    CONJUNCTION.test(word) ||
    ACADEMIC_TITLE.test(word) ||
    PERSONAL_FORMS.has(word) ||
    COLLECTIVE_FORMS.has(word)
  );
}

function isOrganisationWord(word: string): boolean {
  const lower = word.toLowerCase();
  return (
    ORGANISATION_WORDS.has(lower) ||
    ORGANISATION_SUFFIXES.some((suffix) => lower.endsWith(suffix))
  );
}

/** The parts of a line between separators, trimmed, as positions in `text`. */
function splitParts(text: string, line: Span): Span[] {
  const content = text.slice(line.start, line.end);
  const parts: Span[] = [];
  let from = 0;
  for (const separator of [...content.matchAll(SEPARATOR), undefined]) {
    const to = separator ? separator.index : content.length;
    const raw = content.slice(from, to);
    const leading = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed !== "") {
      const start = line.start + from + leading;
      parts.push({ start, end: start + trimmed.length });
    }
    if (separator) from = separator.index + separator[0].length;
  }
  return parts;
}

function lineStartOf(text: string, index: number): number {
  return index === 0 ? 0 : text.lastIndexOf("\n", index - 1) + 1;
}

/** The line before the one that starts at `lineStart`, without its line break. */
function previousLine(text: string, lineStart: number): Span | undefined {
  if (lineStart === 0) return undefined;
  const end = lineStart - 1;
  return { start: lineStartOf(text, end), end };
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
