# Review rules

Every pull request is reviewed against this file. The acceptance criteria for a specific
change are in the pull request description.

## How to review

- Check the diff against the acceptance criteria in the pull request description. Name
  every criterion that is not met or cannot be verified from the diff.
- Report concrete problems only, each with file and line. Do not summarise the change and
  do not praise it.
- Mark each finding as **blocking** or **non-blocking**.
- Formatting and lint rules are enforced by CI and are out of scope here.

## Privacy

Any violation in this section is blocking.

- No real letters and no personal data anywhere in the repository: source, tests,
  fixtures, documentation. Sample letters are invented.
- No secrets in the repository: no keys, no tokens, no `.env` files.
- The text of a letter is never stored on the server. Server logs contain only time,
  status and token counts.
- Letter text is sent to a language model only after redaction in the browser and after
  the user has confirmed what will be sent.
- No analytics and no third-party trackers. The client sends user data to no third party.

## Code

- TypeScript in strict mode. No `any`, no non-null assertion and no `eslint-disable`
  without a comment that explains why it cannot be avoided.
- No dead code. No abstractions for features that are not in scope yet.
- Dates and amounts shown to the user come from structured fields computed by code, never
  from free text written by a language model.
- Non-trivial logic has tests that assert behaviour. A test that only checks that
  something renders does not count.
- User-facing UI works with the keyboard alone, has labelled controls and is usable at a
  width of 375px.

## Language

- Code, comments, commit messages and pull request text are in English.
