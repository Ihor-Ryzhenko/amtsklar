import { describe, expect, test } from "vitest";
import {
  findSensitive,
  redact,
  restore,
  type SensitiveKind,
} from "./redaction";

// All names, numbers and addresses below are invented.
const BLOCK = "Herrn\nMax Mustermann\nMusterstraße 12\n12345 Musterstadt";

/** The redacted spans of `text`, as `[kind, value]` pairs in text order. */
function found(text: string): [SensitiveKind, string][] {
  return findSensitive(text).map((match) => [
    match.kind,
    text.slice(match.start, match.end),
  ]);
}

/** Like `found`, but only the spans of `kind`. */
function foundOf(text: string, kind: SensitiveKind): string[] {
  return found(text)
    .filter(([matchKind]) => matchKind === kind)
    .map(([, value]) => value);
}

/**
 * The spans redacted in `body` when it follows the address block `block`: what the
 * letter's recipient leads to elsewhere in the text.
 */
function foundAfter(block: string, body: string): [SensitiveKind, string][] {
  const text = `${block}\n\n${body}`;
  return findSensitive(text)
    .filter((match) => match.start > block.length)
    .map((match) => [match.kind, text.slice(match.start, match.end)]);
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
      foundOf(
        "Am 01.12.2026 um 09:30 Uhr, 01067 Dresden, Betrag 0,50 € und 1.234,56 €.",
        "phone",
      ),
    ).toEqual([]);
  });

  test("leaves dates written with slashes or hyphens", () => {
    expect(
      found("Frist bis zum 01/12/2026, Termin am 03-12-2026 oder 05/12/26."),
    ).toEqual([]);
  });

  test("stops at the end of the line", () => {
    expect(foundOf("Tel. 030 1234567\n01067 Dresden", "phone")).toEqual([
      "030 1234567",
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

describe("recipient in the address block", () => {
  test.each([
    ["form on its own line", BLOCK],
    [
      "form before the name",
      "Herrn Max Mustermann\nMusterstraße 12\n12345 Musterstadt",
    ],
    ["no form", "Max Mustermann\nMusterstraße 12\n12345 Musterstadt"],
    [
      "one line with commas",
      "Herrn Max Mustermann, Musterstraße 12, 12345 Musterstadt",
    ],
    [
      "line breaks lost",
      "Herrn Max Mustermann Musterstraße 12 12345 Musterstadt",
    ],
    [
      "academic title",
      "Herrn Dr. Max Mustermann\nMusterstraße 12\n12345 Musterstadt",
    ],
  ])("%s", (_, block) => {
    expect(foundOf(block, "address")).toEqual([
      "Musterstraße 12",
      "12345 Musterstadt",
    ]);
    expect(
      foundAfter(
        block,
        "Sie, Max, wohnen in der Musterstraße 12, 12345 Musterstadt. Mustermann",
      ),
    ).toEqual([
      ["name", "Max"],
      ["address", "Musterstraße 12"],
      ["address", "12345 Musterstadt"],
      ["name", "Mustermann"],
    ]);
  });

  test("reads street names in several shapes", () => {
    for (const street of [
      "Am Markt 3a",
      "Berliner Straße 5",
      "Unter den Linden 12-14",
      "Alte Dorfstraße 7",
      "Karl-Marx-Allee 100/2",
    ]) {
      expect(
        foundOf(`Frau\nAnna Muster\n${street}\n12345 Musterstadt`, "address"),
      ).toEqual([street, "12345 Musterstadt"]);
    }
  });

  test("reads cities of more than one word", () => {
    for (const city of [
      "Frankfurt am Main",
      "Halle (Saale)",
      "Bad Musterbach",
      "Mülheim an der Ruhr",
      "Musterstadt-Nord",
    ]) {
      expect(foundOf(`Lindenweg 1\n12345 ${city}`, "address")).toEqual([
        "Lindenweg 1",
        `12345 ${city}`,
      ]);
    }
  });

  test("reads two people with a shared surname", () => {
    expect(
      foundAfter(
        "Eheleute\nAnna und Max Mustermann\nMusterstraße 12\n12345 Musterstadt",
        "Anna, Max",
      ),
    ).toEqual([
      ["name", "Anna"],
      ["name", "Max"],
    ]);
  });

  test("keeps the surname particle with the surname", () => {
    expect(
      foundAfter(
        "Frau\nHanna-Lena von Muster\nMusterweg 1\n12345 Musterstadt",
        "Hanna, Lena, von Muster, von Amts wegen",
      ),
    ).toEqual([
      ["name", "Hanna"],
      ["name", "Lena"],
      ["name", "von Muster"],
    ]);
  });

  test("redacts the authority's address but not its name", () => {
    const line =
      "Jobcenter Musterstadt · Postfach 10 20 30 · 12340 Musterstadt";
    expect(found(line)).toEqual([
      ["address", "Postfach 10 20 30"],
      ["address", "12340 Musterstadt"],
    ]);
    expect(
      found("Agentur für Arbeit Musterstadt\nMusterweg 3\n12340 Musterstadt"),
    ).toEqual([
      ["address", "Musterweg 3"],
      ["address", "12340 Musterstadt"],
    ]);
    expect(
      foundAfter(
        "Familienkasse Musterstadt\nMusterweg 3\n12340 Musterstadt",
        "Ihre Familienkasse Musterstadt",
      ),
    ).toEqual([]);
  });

  test("keeps the authority's name out of a street on a joined line", () => {
    expect(
      found("Familienkasse Musterstadt Musterweg 3 12340 Musterstadt"),
    ).toEqual([
      ["address", "Musterweg 3"],
      ["address", "12340 Musterstadt"],
    ]);
  });

  test("does not take the first word of a two-word street for a name", () => {
    expect(
      found("Herrn Max Mustermann Berliner Straße 5 12345 Musterstadt"),
    ).toEqual([
      ["name", "Max Mustermann"],
      ["address", "Berliner Straße 5"],
      ["address", "12345 Musterstadt"],
    ]);
  });

  test("takes a single word for a surname under a form on its own line", () => {
    expect(
      foundAfter("Frau\nMuster\nMusterweg 1\n12345 Musterstadt", "Muster"),
    ).toEqual([["name", "Muster"]]);
    expect(
      foundAfter("Muster\nMusterweg 1\n12345 Musterstadt", "Muster"),
    ).toEqual([]);
  });

  test("does not take a postal code in the middle of a sentence", () => {
    expect(found("Wir zahlen 12000 Euro an 12345 Personen.")).toEqual([]);
    expect(found("12000 Euro werden erstattet.")).toEqual([]);
  });

  test("leaves the city when it is not next to the postal code", () => {
    expect(foundAfter(BLOCK, "Jobcenter Musterstadt, Musterstadt")).toEqual([]);
  });

  test("leaves another house number in the same street", () => {
    expect(foundAfter(BLOCK, "Musterstraße 120")).toEqual([]);
  });

  test("does not take a single word without a form for a name", () => {
    expect(
      foundOf("Bürgeramt\nRathausplatz 1\n12340 Musterstadt", "name"),
    ).toEqual([]);
  });

  test("does not redact dates when the surname is a month", () => {
    expect(
      foundAfter(
        "Frau\nAnna Mai\nMusterweg 1\n12345 Musterstadt",
        "Frist bis zum 1. Mai 2026, Anna",
      ),
    ).toEqual([["name", "Anna"]]);
  });
});

describe("recipient in the salutation", () => {
  test.each([
    ["Sehr geehrter Herr Mustermann,"],
    ["Sehr geehrte Frau Dr. Mustermann,"],
    ["Guten Tag Herr Mustermann"],
  ])("%s", (salutation) => {
    expect(foundAfter(salutation, "Herr Mustermann zahlt.")).toEqual([
      ["name", "Mustermann"],
    ]);
  });

  test("reads several people in one salutation", () => {
    expect(
      foundAfter(
        "Sehr geehrte Frau Muster, sehr geehrter Herr Mustermann,",
        "Muster, Mustermann",
      ),
    ).toEqual([
      ["name", "Muster"],
      ["name", "Mustermann"],
    ]);
  });

  test("reads no name from a salutation without one", () => {
    expect(found("Sehr geehrte Damen und Herren,\nDamen")).toEqual([]);
    expect(found("Liebe Kundin, lieber Kunde,")).toEqual([]);
  });

  test("finds the surname also when there is no address block", () => {
    expect(
      found("Sehr geehrter Herr Mustermann,\nBedarfsgemeinschaft Mustermann"),
    ).toEqual([
      ["name", "Mustermann"],
      ["name", "Mustermann"],
    ]);
  });
});

describe("name and address variants in the letter", () => {
  test("ignores case, word order and soft hyphens", () => {
    expect(foundAfter(BLOCK, "MUSTERMANN, MAX und Muster­mann")).toEqual([
      ["name", "MUSTERMANN, MAX"],
      ["name", "Muster­mann"],
    ]);
  });

  test("matches either umlaut spelling", () => {
    expect(
      foundAfter(
        "Sehr geehrter Herr Müller,",
        "Herr Mueller, Frau MÜLLER, Herr Müller",
      ),
    ).toEqual([
      ["name", "Mueller"],
      ["name", "MÜLLER"],
      ["name", "Müller"],
    ]);
  });

  test("does not match the name inside another word", () => {
    expect(foundAfter(BLOCK, "Maximilian Maxwell")).toEqual([]);
  });

  const streetSpellings = [
    "Musterstraße 12",
    "Musterstrasse 12",
    "Musterstr. 12",
    "Musterstr 12",
    "MUSTERSTR.12",
  ];
  test.each(
    ["Musterstraße 12", "Musterstrasse 12", "Musterstr. 12"].flatMap(
      (inBlock) =>
        streetSpellings.map((inLetter) => [inBlock, inLetter] as const),
    ),
  )("street %s in the block finds %s", (inBlock, inLetter) => {
    const block = `Herrn\nMax Mustermann\n${inBlock}\n12345 Musterstadt`;
    expect(foundAfter(block, `wohnhaft ${inLetter}`)).toEqual([
      ["address", inLetter],
    ]);
  });
});

describe("overlapping matches", () => {
  test("an IBAN wins over the phone-like digit groups inside it", () => {
    expect(found("DE89 3704 0044 0532 0130 00")).toEqual([
      ["iban", "DE89 3704 0044 0532 0130 00"],
    ]);
  });

  test("an e-mail address wins over the name inside it", () => {
    expect(foundAfter(BLOCK, "max.mustermann@example.de")).toEqual([
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
    const { text: redacted } = redact(text, findSensitive(text));
    expect(redacted).toBe("[IBAN_1], Tel. [PHONE_1], [IBAN_1], Tel. [PHONE_2]");
  });

  test("restores every placeholder in an answer, in any order", () => {
    const text = "Sehr geehrter Herr Mustermann,\nKundennummer 123D456789";
    const { text: redacted, originals } = redact(text, findSensitive(text));
    expect(redacted).toBe(
      "Sehr geehrter Herr [NAME_1],\nKundennummer [CUSTOMER_NO_1]",
    );
    expect(
      restore("[CUSTOMER_NO_1] gehört [NAME_1]; [NAME_1] zahlt.", originals),
    ).toBe("123D456789 gehört Mustermann; Mustermann zahlt.");
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

  const { text: redacted, originals } = redact(letter, findSensitive(letter));

  test("removes every personal value", () => {
    for (const value of [
      "Mustermann",
      "Musterstr. 12",
      "12345 Musterstadt",
      "Postfach 10 20 30",
      "12340 Musterstadt",
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
      "Jobcenter Musterstadt · [ADDRESS_",
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

describe("a letter with a joined address block and no name in the salutation", () => {
  const letter = [
    "Finanzamt Musterstadt · Musterallee 1 · 12340 Musterstadt",
    "Frau Dr. Erika Musterfrau Am Lindenhof 4b 12345 Musterdorf",
    "Steuernummer 12/345/67890   Datum 02.12.2026",
    "Sehr geehrte Damen und Herren,",
    "für Erika Musterfrau setzen wir die Einkommensteuer 2025 auf 1.234,00 € fest.",
    "Ein Einspruch ist innerhalb eines Monats nach Bekanntgabe möglich.",
    "Ihr Finanzamt Musterstadt",
  ].join("\n");
  const { text: redacted } = redact(letter, findSensitive(letter));

  test("removes the name and both addresses", () => {
    for (const value of [
      "Erika",
      "Musterfrau",
      "Am Lindenhof 4b",
      "12345 Musterdorf",
      "Musterallee 1",
      "12340 Musterstadt",
      "12/345/67890",
    ]) {
      expect(redacted).not.toContain(value);
    }
  });

  test("keeps the sender, the date, the amount and the deadline", () => {
    for (const value of [
      "Finanzamt Musterstadt · [ADDRESS_",
      "Frau Dr. [NAME_1] [ADDRESS_",
      "Datum 02.12.2026",
      "Sehr geehrte Damen und Herren,",
      "1.234,00 €",
      "innerhalb eines Monats",
      "Ihr Finanzamt Musterstadt",
    ]) {
      expect(redacted).toContain(value);
    }
  });
});
