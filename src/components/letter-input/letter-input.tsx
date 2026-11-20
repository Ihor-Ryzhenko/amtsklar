"use client";

import { useId, useState } from "react";
import { de } from "@/i18n/de";
import { exceedsLetterLimit, MAX_LETTER_LENGTH } from "@/lib/letter-text";

const numberFormat = new Intl.NumberFormat("de-DE");
const maxLength = numberFormat.format(MAX_LETTER_LENGTH);
const strings = de.letterInput;

export function LetterInput() {
  const [text, setText] = useState("");
  const id = useId();
  const hintId = `${id}-hint`;
  const counterId = `${id}-counter`;
  const errorId = `${id}-error`;
  const tooLong = exceedsLetterLimit(text);

  return (
    <div className="flex w-full flex-col gap-2">
      <label htmlFor={id} className="font-medium">
        {strings.label}
      </label>
      <p id={hintId} className="text-sm text-neutral-600">
        {strings.hint}
      </p>
      {/*
        No maxLength: the browser would silently cut a pasted letter, and the deadline is
        often in the last paragraph. Text over the limit is kept and flagged instead.
        spellCheck is off because enhanced spell checking in Chrome and Edge sends the
        text to the browser vendor.
      */}
      <textarea
        id={id}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        rows={12}
        spellCheck={false}
        aria-invalid={tooLong}
        aria-describedby={
          tooLong
            ? `${hintId} ${counterId} ${errorId}`
            : `${hintId} ${counterId}`
        }
        // 16px text keeps iOS Safari from zooming in when the field gets focus.
        className="w-full rounded-md border border-neutral-500 p-3 text-base aria-invalid:border-red-700"
      />
      <p
        id={counterId}
        className={
          tooLong ? "text-sm text-red-700" : "text-sm text-neutral-600"
        }
      >
        {strings.counter(numberFormat.format(text.length), maxLength)}
      </p>
      {/* The message does not change while it is shown, so it is announced once. */}
      <p id={errorId} aria-live="polite" className="text-sm text-red-700">
        {tooLong ? strings.tooLong(maxLength) : null}
      </p>
    </div>
  );
}
