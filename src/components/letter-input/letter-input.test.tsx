import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { MAX_LETTER_LENGTH } from "@/lib/letter-text";
import { LetterInput } from "./letter-input";

const tooLongMessage = /länger als 20\.000 Zeichen/;

function getField(): HTMLTextAreaElement {
  const field = screen.getByRole("textbox", { name: "Text des Briefs" });
  if (!(field instanceof HTMLTextAreaElement)) {
    throw new Error("The letter field should be a textarea.");
  }
  return field;
}

describe("LetterInput", () => {
  test("counts characters as the user types", () => {
    render(<LetterInput />);
    expect(screen.getByText("0 von 20.000 Zeichen")).toBeDefined();

    fireEvent.change(getField(), { target: { value: "Sehr geehrte" } });

    expect(screen.getByText("12 von 20.000 Zeichen")).toBeDefined();
  });

  test("accepts text exactly at the limit", () => {
    render(<LetterInput />);

    fireEvent.change(getField(), {
      target: { value: "a".repeat(MAX_LETTER_LENGTH) },
    });

    expect(getField().getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText(tooLongMessage)).toBeNull();
  });

  test("keeps text over the limit uncut and flags it", () => {
    render(<LetterInput />);
    const value = "a".repeat(MAX_LETTER_LENGTH + 1);

    fireEvent.change(getField(), { target: { value } });

    const field = getField();
    expect(field.value).toHaveLength(MAX_LETTER_LENGTH + 1);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("20.001 von 20.000 Zeichen")).toBeDefined();

    const error = screen.getByText(tooLongMessage);
    expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(
      error.id,
    );
  });

  test("clears the error once the text is short enough again", () => {
    render(<LetterInput />);
    fireEvent.change(getField(), {
      target: { value: "a".repeat(MAX_LETTER_LENGTH + 1) },
    });

    fireEvent.change(getField(), {
      target: { value: "a".repeat(MAX_LETTER_LENGTH) },
    });

    expect(getField().getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText(tooLongMessage)).toBeNull();
  });

  test("turns off browser spell checking", () => {
    render(<LetterInput />);

    expect(getField().getAttribute("spellcheck")).toBe("false");
  });
});
