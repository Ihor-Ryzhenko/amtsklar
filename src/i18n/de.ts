// Interface strings. German is the default and, for now, the only interface language.
export const de = {
  letterInput: {
    label: "Text des Briefs",
    hint: "Fügen Sie den Text des Briefs ein. Bevor etwas gesendet wird, sehen Sie genau, was übertragen wird.",
    counter: (length: string, max: string) => `${length} von ${max} Zeichen`,
    tooLong: (max: string) =>
      `Der Text ist länger als ${max} Zeichen. Bitte kürzen Sie ihn.`,
  },
} as const;
