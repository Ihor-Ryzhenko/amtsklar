import { describe, expect, test } from "vitest";
import {
  findSensitive,
  type Profile,
  redact,
  restore,
  type SensitiveKind,
} from "./redaction";

// All names, numbers and addresses below are invented.
const NO_PROFILE: Profile = {
  firstName: "",
  lastName: "",
  street: "",
  postalCode: "",
  city: "",
};

const PROFILE: Profile = {
  firstName: "Max",
  lastName: "Mustermann",
  street: "Musterstraße 12",
  postalCode: "12345",
  city: "Musterstadt",
};

/** The redacted spans of `text`, as `[kind, value]` pairs in text order. */
function found(
  text: string,
  profile: Profile = NO_PROFILE,
): [SensitiveKind, string][] {
  return findSensitive(text, profile).map((match) => [
    match.kind,
    text.slice(match.start, match.end),
  ]);
}

describe("IBAN", () => {
  test("finds an IBAN written in groups and compact", () => {
    expect(found("IBAN: DE89 3704 0044 0532 0130 00")).toEqual([
      ["iban", "DE89 3704 0044 0532 0130 00"],
    ]);
    expect(found("auf DE89370400440532013000 überweisen")).toEqual([
      ["iban", "DE89370400440532013000"],
    ]);
  });

  test("stops before a following BIC", () => {
    expect(found("IBAN DE89 3704 0044 0532 0130 00 BIC COBADEFFXXX")).toEqual([
      ["iban", "DE89 3704 0044 0532 0130 00"],
    ]);
  });

  test("ignores a string with a wrong checksum", () => {
    expect(found("DE89 3704 0044 0532 0130 01")).not.toContainEqual([
      "iban",
      expect.any(String),
    ]);
  });

  test("ignores capitalised words followed by digits", () => {
    expect(found("Anlage AB12 zum Bescheid vom 01.12.2026")).toEqual([]);
  });
});

describe("e-mail", () => {
  test("finds an address and leaves the full stop after it", () => {
    expect(found("Schreiben Sie an max.m-1@example.de.")).toEqual([
      ["email", "max.m-1@example.de"],
    ]);
  });
});

describe("phone", () => {
  test.each([
    ["+49 30 1234567"],
    ["030 / 123 45-67"],
    ["(030) 1234567"],
    ["0049 30 1234567"],
    ["0151 23456789"],
    ["0151-123-4567"],
  ])("finds %s", (number) => {
    expect(found(`Telefon: ${number}`)).toEqual([["phone", number]]);
  });

  test("leaves dates, amounts, postal codes and times", () => {
    expect(
      found(
        "Am 01.12.2026 um 09:30 Uhr, 01067 Dresden, Betrag 0,50 € und 1.234,56 €.",
      ),
    ).toEqual([]);
  });

  test("leaves dates written with slashes or hyphens", () => {
    expect(
      found("Frist bis zum 01/12/2026, Termin am 03-12-2026 oder 05/12/26."),
    ).toEqual([]);
  });

  test("stops at the end of the line", () => {
    expect(found("Tel. 030 1234567\n01067 Dresden")).toEqual([
      ["phone", "030 1234567"],
    ]);
  });
});

describe("birth date", () => {
  test.each([
    ["geb. 01.02.1980", "01.02.1980"],
    ["geb. am 1.2.80", "1.2.80"],
    ["geboren am 1. Februar 1980", "1. Februar 1980"],
    ["Geburtsdatum: 01.02.1980", "01.02.1980"],
  ])("finds the date in %s", (text, date) => {
    expect(found(text)).toEqual([["birthDate", date]]);
  });

  test("leaves dates without a birth keyword", () => {
    expect(
      found("Bescheid vom 01.12.2026, Frist bis zum 15.12.2026, geb. Muster"),
    ).toEqual([]);
  });
});

describe("numbers after a keyword", () => {
  test.each<[string, SensitiveKind, string]>([
    ["Aktenzeichen: 123/45-ABC", "caseNo", "123/45-ABC"],
    ["Az.: 4711-2026-1", "caseNo", "4711-2026-1"],
    ["Geschäftszeichen 541.12 ZB", "caseNo", "541.12"],
    ["Kundennummer 123D456789", "customerNo", "123D456789"],
    ["Kunden-Nr.: 987 654 321", "customerNo", "987 654 321"],
    ["Beitragsnummer: 123 456 789", "customerNo", "123 456 789"],
    ["Mitgliedsnummer K12-3456", "customerNo", "K12-3456"],
    ["BG-Nummer: 123A4567", "bgNo", "123A4567"],
    ["Versicherungsnummer: 12-3456-789", "insuranceNo", "12-3456-789"],
    ["Steuernummer 12/345/67890", "taxId", "12/345/67890"],
  ])("%s", (text, kind, value) => {
    expect(found(text)).toEqual([[kind, value]]);
  });

  test("stops at the first word without a digit", () => {
    expect(found("Unser Zeichen: 541.12 Datum: 01.12.2026")).toEqual([
      ["caseNo", "541.12"],
    ]);
  });

  test("does not take a date as the number", () => {
    expect(found("Ihr Zeichen vom 01.12.2026")).toEqual([]);
    expect(found("Aktenzeichen\n01.12.2026")).toEqual([]);
    expect(found("Aktenzeichen: 03/12/2026")).toEqual([]);
  });

  test("leaves the full stop at the end of a sentence", () => {
    expect(found("Bitte geben Sie das Az. 12/34. an.")).toEqual([
      ["caseNo", "12/34"],
    ]);
  });

  test("skips a note in brackets and reads a value on the next line", () => {
    expect(
      found("Kundennummer (bitte immer angeben):\n123D45678\nSehr geehrte"),
    ).toEqual([["customerNo", "123D45678"]]);
  });

  test("does not mistake a word that starts like a keyword", () => {
    expect(found("Azubi 2026")).toEqual([]);
  });
});

describe("numbers with a recognisable format", () => {
  test.each<[string, SensitiveKind, string]>([
    ["BG 12345BG0012345 laut Bescheid", "bgNo", "12345BG0012345"],
    ["RV 12 010280 M 123 gemeldet", "insuranceNo", "12 010280 M 123"],
    ["KV A123456789 gültig", "insuranceNo", "A123456789"],
    ["ID 47 158 236 906 gespeichert", "taxId", "47 158 236 906"],
  ])("%s", (text, kind, value) => {
    expect(found(text)).toEqual([[kind, value]]);
  });

  test("ignores eleven digits with a wrong tax ID check digit", () => {
    expect(found("Nr 47 158 236 905")).toEqual([]);
  });
});

describe("profile", () => {
  test("finds the full name, the surname and the first name", () => {
    expect(
      found(
        "Herrn Max Mustermann\nSehr geehrter Herr Mustermann,\nlieber Max,",
        PROFILE,
      ),
    ).toEqual([
      ["name", "Max Mustermann"],
      ["name", "Mustermann"],
      ["name", "Max"],
    ]);
  });

  test("ignores case, word order and soft hyphens", () => {
    expect(found("MUSTERMANN, MAX und Muster­mann", PROFILE)).toEqual([
      ["name", "MUSTERMANN, MAX"],
      ["name", "Muster­mann"],
    ]);
  });

  test("matches either umlaut spelling", () => {
    const profile = { ...NO_PROFILE, lastName: "Müller" };
    expect(found("Herr Mueller, Frau MÜLLER, Herr Müller", profile)).toEqual([
      ["name", "Mueller"],
      ["name", "MÜLLER"],
      ["name", "Müller"],
    ]);
  });

  test("does not match the name inside another word", () => {
    expect(found("Maximilian Maxwell", PROFILE)).toEqual([]);
  });

  test("splits double first names but not surnames", () => {
    const profile = {
      ...NO_PROFILE,
      firstName: "Hans-Peter",
      lastName: "von Muster",
    };
    expect(found("Hans, von Muster, von Amts wegen", profile)).toEqual([
      ["name", "Hans"],
      ["name", "von Muster"],
    ]);
  });

  test.each([
    ["Musterstraße 12"],
    ["Musterstrasse 12"],
    ["Musterstr. 12"],
    ["MUSTERSTR.12"],
  ])("finds the street written as %s", (street) => {
    expect(found(`${street}, 12345 Musterstadt`, PROFILE)).toEqual([
      ["address", street],
      ["address", "12345 Musterstadt"],
    ]);
  });

  test("leaves the city when it is not next to the postal code", () => {
    expect(
      found(
        "Jobcenter Musterstadt, Postfach 10 20 30, 12340 Musterstadt",
        PROFILE,
      ),
    ).toEqual([]);
  });

  test("leaves another house number in the same street", () => {
    expect(found("Musterstraße 120", PROFILE)).toEqual([]);
  });
});

describe("overlapping matches", () => {
  test("an IBAN wins over the phone-like digit groups inside it", () => {
    expect(found("DE89 3704 0044 0532 0130 00")).toEqual([
      ["iban", "DE89 3704 0044 0532 0130 00"],
    ]);
  });

  test("an e-mail address wins over the name inside it", () => {
    expect(found("max.mustermann@example.de", PROFILE)).toEqual([
      ["email", "max.mustermann@example.de"],
    ]);
  });

  test("a case number wins over a phone match of the same length", () => {
    expect(found("Az. 0815/4711")).toEqual([["caseNo", "0815/4711"]]);
  });
});

describe("redact and restore", () => {
  test("numbers placeholders per kind and reuses them for equal values", () => {
    const text =
      "DE89 3704 0044 0532 0130 00, Tel. 030 1234567, DE89 3704 0044 0532 0130 00, Tel. 040 7654321";
    const { text: redacted } = redact(text, findSensitive(text, NO_PROFILE));
    expect(redacted).toBe("[IBAN_1], Tel. [PHONE_1], [IBAN_1], Tel. [PHONE_2]");
  });

  test("restores every placeholder in an answer, in any order", () => {
    const text = "Herr Max Mustermann, Kundennummer 123D456789";
    const { text: redacted, originals } = redact(
      text,
      findSensitive(text, PROFILE),
    );
    expect(redacted).toBe("Herr [NAME_1], Kundennummer [CUSTOMER_NO_1]");
    expect(
      restore("[CUSTOMER_NO_1] gehört [NAME_1]; [NAME_1] zahlt.", originals),
    ).toBe("123D456789 gehört Max Mustermann; Max Mustermann zahlt.");
  });

  test("leaves a placeholder that the model invented", () => {
    const { originals } = redact("Tel. 030 1234567", [
      { start: 5, end: 16, kind: "phone" },
    ]);
    expect(restore("[PHONE_1] oder [PHONE_2]", originals)).toBe(
      "030 1234567 oder [PHONE_2]",
    );
  });

  test("keeps a value containing a dollar sign as it is", () => {
    const { originals } = redact("a$&b", [{ start: 0, end: 4, kind: "name" }]);
    expect(restore("[NAME_1]", originals)).toBe("a$&b");
  });

  test("rejects overlapping matches", () => {
    expect(() =>
      redact("abcdef", [
        { start: 0, end: 4, kind: "name" },
        { start: 2, end: 6, kind: "phone" },
      ]),
    ).toThrow();
  });
});

describe("a whole letter", () => {
  const letter = [
    "Jobcenter Musterstadt · Postfach 10 20 30 · 12340 Musterstadt",
    "",
    "Herrn",
    "Max Mustermann",
    "Musterstr. 12",
    "12345 Musterstadt",
    "",
    "Ihr Zeichen: –   Unser Zeichen: 541.12 ZB   Datum: 01.12.2026",
    "BG-Nummer: 12345BG0012345   Kundennummer: 123D456789",
    "Telefon: 0123 456789-0   E-Mail: jobcenter-musterstadt@example.de",
    "",
    "Mitwirkungsaufforderung",
    "",
    "Sehr geehrter Herr Mustermann,",
    "",
    "für die Prüfung Ihres Antrags vom 14.11.2026 benötigen wir Kontoauszüge",
    "zu Ihrem Konto DE89 3704 0044 0532 0130 00 für die letzten drei Monate.",
    "Bitte reichen Sie die Unterlagen innerhalb von 14 Tagen, spätestens bis zum",
    "15.12.2026, ein. Ihr Termin: 03.12.2026 um 09:30 Uhr, Zimmer 0.12.",
    "Erhalten Sie bereits 563,00 € monatlich, bleibt der Betrag von 1.234,56 €",
    "unberührt. Kommen Sie Ihrer Mitwirkungspflicht nach § 60 SGB I nicht nach,",
    "können die Leistungen nach § 66 SGB I ganz versagt werden.",
    "",
    "Mit freundlichen Grüßen",
    "Ihr Jobcenter Musterstadt",
  ].join("\n");

  const { text: redacted, originals } = redact(
    letter,
    findSensitive(letter, PROFILE),
  );

  test("removes every personal value", () => {
    for (const value of [
      "Mustermann",
      "Musterstr. 12",
      "12345 Musterstadt",
      "541.12",
      "12345BG0012345",
      "123D456789",
      "0123 456789-0",
      "jobcenter-musterstadt@example.de",
      "DE89 3704 0044 0532 0130 00",
    ]) {
      expect(redacted).not.toContain(value);
    }
  });

  // If redaction ate a date or an amount, the deadline and the card would be wrong.
  test("keeps the sender, dates, deadlines, amounts and legal references", () => {
    for (const value of [
      "Jobcenter Musterstadt · Postfach 10 20 30 · 12340 Musterstadt",
      "Datum: 01.12.2026",
      "vom 14.11.2026",
      "innerhalb von 14 Tagen, spätestens bis zum\n15.12.2026",
      "03.12.2026 um 09:30 Uhr, Zimmer 0.12",
      "563,00 €",
      "1.234,56 €",
      "§ 60 SGB I",
      "§ 66 SGB I",
      "Ihr Jobcenter Musterstadt",
    ]) {
      expect(redacted).toContain(value);
    }
  });

  test("restores the original letter from the redacted text", () => {
    expect(restore(redacted, originals)).toBe(letter);
  });
});
