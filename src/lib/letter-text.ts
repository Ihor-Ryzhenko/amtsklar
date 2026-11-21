/**
 * Longest letter text the app accepts, measured with `String.prototype.length`.
 * The browser checks it before anything is sent; the server will apply the same limit.
 */
export const MAX_LETTER_LENGTH = 20_000;

export function exceedsLetterLimit(text: string): boolean {
  return text.length > MAX_LETTER_LENGTH;
}
