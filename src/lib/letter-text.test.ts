import { describe, expect, test } from "vitest";
import { exceedsLetterLimit, MAX_LETTER_LENGTH } from "./letter-text";

describe("exceedsLetterLimit", () => {
  test("accepts text exactly at the limit", () => {
    expect(exceedsLetterLimit("a".repeat(MAX_LETTER_LENGTH))).toBe(false);
  });

  test("rejects text one character over the limit", () => {
    expect(exceedsLetterLimit("a".repeat(MAX_LETTER_LENGTH + 1))).toBe(true);
  });

  test("counts whitespace and line breaks", () => {
    const text = `${"a".repeat(MAX_LETTER_LENGTH - 1)}\n `;
    expect(exceedsLetterLimit(text)).toBe(true);
  });
});
