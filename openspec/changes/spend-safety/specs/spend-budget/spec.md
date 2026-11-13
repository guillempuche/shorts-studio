## MODIFIED Requirements

### Requirement: A submitted request SHALL be resumed, not paid again

A command SHALL save the provider's request id and result URLs in `post.json` before it waits for the result. Sending a request and saving it SHALL finish together, even when the run is interrupted while sending. A later run SHALL check on that saved request instead of sending a new one, and no command SHALL drop it before it's fetched. One run at a time SHALL make a post's images. When the provider reports a request as failed, its reservation SHALL be released.

#### Scenario: Interrupted after sending

- **WHEN** a run is interrupted after it sends a request
- **AND** it runs again
- **THEN** the provider got one request
- **AND** the ledger holds one reservation

#### Scenario: Interrupted while sending

- **WHEN** a run is interrupted while the provider is still answering a request
- **THEN** the request is saved in `post.json` once the provider answers
- **AND** the next run resumes it instead of sending another

#### Scenario: Two runs on one post

- **WHEN** `image generate --yes` is making a post's images
- **AND** a second `image generate --yes` starts on the same post
- **THEN** the second sends nothing
- **AND** after waiting for the lock, it fails with `conflict`, naming the first run's process and command

#### Scenario: Saved requests come first

- **WHEN** beat 3 has a saved request and beats 0 to 2 have no image
- **AND** `image generate --yes` runs
- **THEN** beat 3's image is fetched before any new request is sent

### Requirement: A dry run SHALL spend nothing

With `--dry-run`, or without `--yes` on a CLI command that needs it, a spending command SHALL report what it would make, the estimated cost, and whether the real run could go ahead: the keys it would call the provider with are set, and the estimate fits the caps, counting what a batch dry run planned for earlier posts. When it couldn't, it SHALL name what stops it. It SHALL change nothing. Transcription SHALL take a dry run, but SHALL NOT need `--yes`.

#### Scenario: Without --yes

- **WHEN** `image generate` runs without `--yes`
- **AND** its estimate is above $0 and fits the caps
- **THEN** it prints the estimate
- **AND** it exits 3

#### Scenario: A transcription dry run

- **WHEN** `audio transcribe --dry-run` runs on 2 minutes of audio
- **THEN** it prints the price of 2 minutes
- **AND** nothing is reserved or sent

#### Scenario: A dry run that wouldn't fit

- **WHEN** `image generate --dry-run` estimates more than is left of today's cap
- **THEN** its result says the estimate doesn't fit
- **AND** it names `caps.dailyUsd`
- **AND** it exits 0

#### Scenario: A dry run without the key

- **WHEN** `FAL_KEY` isn't set
- **AND** `image generate --dry-run` would send or fetch a request
- **THEN** its result says the real run can't go ahead, stopped by `missing-key`
- **AND** it names `FAL_KEY`
- **AND** it exits 0

### Requirement: Spending SHALL be easy to see

`budget show` SHALL report today's spending against the daily cap, this month's against the monthly cap, and each post's total against the per-post cap. It SHALL say where each cap was set: its default, `config.json`, or a `SHORTS_*` variable. It SHALL list every setting that can't be used. Reservations that are not settled yet SHALL count at their estimate.

#### Scenario: After generating images

- **WHEN** a post's images were generated today
- **THEN** today's total and the post's total include their cost

#### Scenario: Caps that may be the defaults

- **WHEN** config.json isn't valid JSON
- **AND** `budget show --json` runs
- **THEN** its result lists the config.json problem
- **AND** it says each cap is the default

#### Scenario: A cap set by a variable

- **WHEN** `SHORTS_CAPS_DAILY_USD` is 1
- **AND** `budget show` runs
- **THEN** it says the daily cap of $1 comes from `SHORTS_CAPS_DAILY_USD`

### Requirement: A reservation SHALL be freed only when nothing was billed

A reservation SHALL be freed only when nothing was billed: the provider refused to take the request (an HTTP 4xx) or reported the job failed, or the call stopped before anything was sent, such as on a missing key. When the outcome is unknown, because the provider answered with a 5xx, the connection dropped or the command stopped mid-call, the reservation SHALL stay counted at its estimate. A result that was paid for SHALL be kept even when its ledger line can't be closed.

#### Scenario: The connection drops while sending

- **WHEN** the connection drops before the provider answers a request
- **THEN** the reservation still counts toward the caps

#### Scenario: A server error while sending

- **WHEN** the provider answers a request with a 502
- **THEN** the reservation still counts toward the caps

#### Scenario: The provider refuses

- **WHEN** the provider answers that the key is wrong
- **THEN** the reservation is freed

#### Scenario: A 4xx about a job already taken

- **WHEN** the provider answers 404 while an accepted request's result is being collected
- **THEN** the reservation still counts toward the caps

#### Scenario: The ledger can't be closed

- **WHEN** a paid call succeeds but its ledger line can't be written
- **THEN** its result is kept
- **AND** its reservation counts in full

#### Scenario: The provider can't be reached

- **WHEN** the connection to the provider is refused, its name doesn't resolve, or its TLS handshake fails, so the request is never sent
- **AND** `audio transcribe` runs three times
- **THEN** each run fails with code `provider`
- **AND** today's total is what it was before the first run

### Requirement: The error SHALL name the cap that waiting fixes last

When a call would pass several caps, the error SHALL name the post's cap first, then the month's, then the day's, and where that cap was set. It SHALL tell the user to wait only for a day's or a month's cap above $0, and SHALL say that raising a cap is the user's decision, not tell the reader to raise it.

#### Scenario: Every cap would be passed

- **WHEN** a call would pass the daily, monthly and per-post caps
- **THEN** it fails with `over-budget`
- **AND** the fix names `caps.postUsd` and doesn't say to wait
- **AND** the fix says raising it is the user's decision

#### Scenario: A cap set by a variable

- **WHEN** `SHORTS_CAPS_DAILY_USD` sets the daily cap
- **AND** a call would pass it
- **THEN** the fix names `SHORTS_CAPS_DAILY_USD`
- **AND** it doesn't name config.json

### Requirement: The ledger SHALL be read strictly

A ledger line whose time isn't written as commands write it, or whose amount is below zero, SHALL make the read fail, naming the line and the form to use. The fix SHALL leave changing the ledger to the user, since the caps are checked against it, except for an unfinished last line left by a write that was cut off, which it SHALL say to remove.

#### Scenario: A hand-edited time

- **WHEN** a ledger line's time is written as `2026-11-03T20:00:00-05:00`
- **THEN** reading the ledger fails, naming that line
- **AND** the fix says what to do with that line is the user's decision

#### Scenario: An unfinished last line

- **WHEN** the ledger's last line stops mid-way and has no line end
- **THEN** reading the ledger fails, naming that line
- **AND** the fix says to remove that line

### Requirement: Spending SHALL stop while the settings aren't valid

When `config.json`, `brand.json` or a `SHORTS_*` variable can't be used, or names a setting that doesn't exist, a paid call SHALL fail before it reserves or sends anything, and a dry run SHALL say its estimate doesn't fit. The message SHALL say what that puts at risk: caps that may be the defaults, images without the brand's style, or one setting back at its default. Other commands SHALL still run, with a warning on stderr that names the problem.

#### Scenario: A bad setting next to lowered caps

- **WHEN** config.json sets `caps.dailyUsd` to 0.5 and `captions.fontSize` to `"big"`
- **AND** `audio transcribe` runs
- **THEN** nothing is reserved or sent
- **AND** the fix names `doctor`

#### Scenario: A command that spends nothing

- **WHEN** `budget show` runs with the same config.json
- **THEN** it runs
- **AND** stderr names config.json and the problem

#### Scenario: A misspelt cap

- **WHEN** config.json sets `caps.daily` to 0.5
- **AND** `audio transcribe` runs
- **THEN** nothing is reserved or sent
- **AND** the message names `caps.daily` and `caps.dailyUsd`, and says the caps may be the defaults

#### Scenario: A broken brand.json

- **WHEN** brand.json isn't valid
- **AND** `image generate --yes` runs
- **THEN** nothing is reserved or sent
- **AND** the message says images would be made without the brand's style
- **AND** it doesn't say the caps may be the defaults

## ADDED Requirements

### Requirement: A reroll SHALL keep the old seed until its request is saved

`image generate --reroll` SHALL refuse, with `conflict`, a beat whose paid request is saved but not fetched, and say to run it without `--reroll` first. It SHALL save a beat's new seed in the same write as its new request, so a reroll stopped before sending, by a cap, a setting, a refusal or Ctrl-C, leaves the seed as it was.

#### Scenario: A reroll over a saved request

- **WHEN** beat 1 has a saved request
- **AND** `image generate --beat 1 --reroll --yes` runs
- **THEN** it fails with `conflict` and sends nothing
- **AND** beat 1's saved request is still there
- **AND** the fix names `image generate --post <slug> --beat 1` without `--reroll`

#### Scenario: A reroll over the cap

- **WHEN** rerolling beat 0 would pass today's cap
- **AND** `image generate --beat 0 --reroll --yes` runs
- **THEN** it fails with `over-budget`
- **AND** beat 0's seed is what it was before

### Requirement: A run stopped by a cap SHALL say what's already paid for

When a cap stops `image generate` part-way, its error SHALL keep the code `over-budget` and name the beats whose images it saved and the beats whose requests are saved but not fetched. When there are any of the latter, its fix SHALL offer fetching them, which costs nothing.

#### Scenario: A saved request left behind

- **WHEN** beat 4 has a saved request
- **AND** a new request for beat 1 would pass the per-post cap while beat 4 isn't fetched yet
- **THEN** `image generate --yes` fails with `over-budget`
- **AND** the message names beat 4 as paid for but not fetched
- **AND** the fix names `image generate --post <slug> --beat 4`

### Requirement: A dry run that can't go ahead SHALL say who clears the way

When a dry run says the real run can't go ahead, its next steps SHALL start with the user's step for what stops it: setting the key it names, deciding about the cap, or fixing the setting it names, followed by the agent's `config_check`. When some chosen beats have requests saved but not fetched, the steps SHALL also offer fetching them, which costs nothing.

#### Scenario: Stopped by a setting

- **WHEN** `image generate --dry-run` can't go ahead because config.json isn't valid
- **THEN** its first step is the user's, naming config.json and the problem
- **AND** a later step is the tool `config_check`, by `agent`

#### Scenario: Stopped by a missing key

- **WHEN** `image generate --dry-run` can't go ahead because `FAL_KEY` isn't set
- **THEN** its first step is the user's, naming `FAL_KEY`, with no tool

#### Scenario: Stopped by a cap, with images already paid for

- **WHEN** beat 2 has a saved request and the new requests would pass today's cap
- **AND** `image generate --dry-run` runs
- **THEN** its first step is the user's, naming `caps.dailyUsd`
- **AND** a later step is the tool `image_generate` with `{ post: <slug>, beat: "2" }`, by `agent`

### Requirement: The CLI SHALL ask for --yes only when the run could go ahead

Without `--yes`, a CLI spending command that needs it SHALL fail with `needs-confirmation` only when its dry run could go ahead. When it couldn't, it SHALL fail as the real run would: `over-budget` past a cap, `missing-key` without a key, `failed` on a setting. A run whose estimate is $0, such as one that only fetches saved requests, SHALL NOT need `--yes`, and SHALL run for real.

#### Scenario: Without --yes, over a cap

- **WHEN** `image generate` runs without `--yes`
- **AND** its estimate would pass today's cap
- **THEN** it fails with `over-budget` and exits 4
- **AND** nothing is reserved or sent

#### Scenario: Only saved requests to fetch

- **WHEN** every beat without an image has a saved request
- **AND** `image generate` runs without `--yes`
- **THEN** the images are fetched and saved
- **AND** no new request is sent
- **AND** it exits 0

### Requirement: A failed paid call SHALL say whether it was counted

The fix of a failed paid call SHALL say whether its cost was counted and what running it again does. When nothing was billed, it SHALL say nothing was counted and, after a refusal, what to change first. When the outcome is unknown, it SHALL say the cost stays counted and that running it again pays for a new request. When the request never left the machine, it SHALL say the provider can't be reached and to tell the user.

#### Scenario: The provider can't be reached

- **WHEN** `audio transcribe` fails because the connection is refused
- **THEN** the fix says nothing was counted
- **AND** it says the provider can't be reached and to tell the user

#### Scenario: A wrong key

- **WHEN** the provider answers 401 to an image request
- **THEN** the fix says nothing was counted
- **AND** it names `FAL_KEY` as what to change before running it again

#### Scenario: A server error

- **WHEN** the provider answers 502 to a transcription request
- **THEN** the fix says its cost stays counted
- **AND** it says running it again pays for a new request

### Requirement: Amounts SHALL be shown so they can be told apart

A dollar amount above $0 SHALL never be shown as $0.00, and an amount below the cap it's compared with SHALL never be shown as equal to it. Dollar amounts in JSON results SHALL be rounded to millionths of a dollar.

#### Scenario: A sub-cent cap

- **WHEN** `caps.dailyUsd` is 0.004 and $0.003 was spent today
- **AND** `budget show` runs
- **THEN** it shows the two amounts as different numbers, neither as $0.00

#### Scenario: A transcription estimate

- **WHEN** `audio transcribe --dry-run` estimates $0.0003
- **THEN** it shows ~$0.0003, not ~$0.000

#### Scenario: A total in JSON

- **WHEN** three reservations of $0.02405 were made today
- **AND** `budget show --json` runs
- **THEN** `todayUsd` is 0.07215
