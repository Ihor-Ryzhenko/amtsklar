# Review rules

Every pull request is reviewed against this file. The acceptance criteria for a specific
change are in the pull request description.

## How to review

- Check the diff against the acceptance criteria in the pull request description. Name
  every criterion that is not met or cannot be verified from the diff.
- Report concrete problems only. Do not summarise the change and do not praise it.
- Every finding cites a file and line. A finding about an acceptance criterion that is not
  met cites that criterion from the pull request description instead. A claim about
  behaviour is based on the code you read, not on the name of a function or variable. A
  finding under a rule in this file quotes that rule.
- Before posting, check each finding against the code once more. If you are not sure the
  problem is real, drop it.
- If the pull request changes `REVIEW.md` or anything under `.github/`, say so in the first
  line of the summary comment.

## Severity

Mark each finding as **blocking** or **non-blocking**.

Blocking:

- any violation of the Privacy section;
- code that produces a wrong result: wrong date, wrong amount, data lost or shown to the
  wrong place;
- an acceptance criterion that is not met;
- a violation of the Type safety rule in the Code section;
- a missing test for an area listed under Tests.

Everything else is non-blocking. Report at most five non-blocking findings per review,
the most important first.

## Do not report

- Anything CI enforces: formatting, lint, type errors, failing tests.
- Problems in code that the pull request does not change.
- `pnpm-lock.yaml` and generated files.
- Naming, style and refactoring preferences that no rule in this file requires.
- General quality concerns that no rule in this file covers.

## Privacy

Any violation in this section is blocking.

- No real letters and no personal data anywhere in the repository: source, tests,
  fixtures, documentation. Sample letters are invented.
- No secrets in the repository: no keys, no tokens, no `.env` files.
- Letter text, uploaded files and results are stored only in the browser. The server
  never stores letter text. Server logs contain only time, status and token counts.
- Letter text is sent to a language model only after redaction in the browser and after
  the user has confirmed what will be sent. Placeholders such as `[NAME]` are filled back
  in only in the browser.
- Every request to the model provider sets `data_collection: "deny"`.
- Letter text never appears in a URL, a query string, a route segment or a cookie: those
  end up in request logs.
- A module that calls the model provider or reads a secret imports `server-only`.
- No environment variable with the `NEXT_PUBLIC_` prefix holds a secret.
- No analytics and no third-party trackers. The client sends user data to no third party.
- Every new dependency in `package.json` is named and justified in the pull request
  description. A dependency that sends data over the network on its own (telemetry,
  analytics, remote configuration) is blocking.

## Code

- **Type safety.** TypeScript in strict mode. No `any`, no non-null assertion and no
  `eslint-disable` without a comment that explains why it cannot be avoided.
- No dead code. No options, parameters or extension points that no acceptance criterion
  of the pull request requires.
- Dates and amounts shown to the user come from structured fields computed by code, never
  from free text written by a language model.
- A field is shown as verified only if its quote was found in the letter text.

## Tests

- These areas need tests that assert behaviour: redaction and placeholder restoration,
  deadline calculation, quote matching, parsing and validation of model output, backup
  export and import.
- A test that only checks that something renders does not count.

## User interface

Report only what is visible in the code:

- controls without an accessible label;
- click handlers on elements that cannot be reached or used with the keyboard;
- fixed widths or layouts that cannot fit a 375px screen.

## Language

- Code, comments, commit messages, pull request text and review comments are in English.
- Exceptions: the README is in German and English; interface strings are in German,
  English, Russian and Ukrainian; legal pages and sample letters are in German.
