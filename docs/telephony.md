# Telephony (R4)

How we place calls, what is built, and the record of every telephony test with its result and
date. Owner: R4 (Saleh Alrakban). Code: `app/telephony/`. Interface: [integration §3](integration.md#3-r4--r2-callprovider-and-retrypolicy).

> **Status (5 Nov 2026):** everything below runs **offline only**, tested on synthetic
> responses written from Twilio's and ElevenLabs' public docs. No account, number or key exists
> yet, so **no test in §4 has been run**. Nothing here is a result.

## 1. What is built

| Piece | File | What it does |
|---|---|---|
| Allowlist | `allowlist.py` | Refuses every number not in `TELEPHONY_ALLOWLIST` / `TELEPHONY_ALLOWLIST_FILE`. Empty by default, so it refuses everything. Exact E.164 only. Numbers are masked in logs (`+966*******01`). |
| Outcome mapping | `outcomes.py` | Turns a Twilio call plus an ElevenLabs conversation into one of the 9 contract outcomes. The rules are in the module docstring. |
| Calling hours | `calling_hours.py` | Riyadh time: 10:00–12:00 and 16:30–22:30, not Friday before 13:00, not during prayer windows (monthly Umm al-Qura table). |
| Retry policy | `retry.py` | `R4RetryPolicy`: only `no_answer` / `busy`, once, 10 min later, and only if the whole retry fits in calling hours. Never after a timeout or crash. |
| Call provider | `provider.py`, `http.py` | `TwilioElevenLabsCalls`. It checks the allowlist and calling hours first (pre-arranged numbers skip the hours check), then starts the ElevenLabs outbound call, polls Twilio and ElevenLabs, maps the outcome, converts `user` to `shop`, adds cost and timing, and hangs up on cancellation. Uses standard-library HTTP in a worker thread. **Not activated.** |

## 2. Settings (`.env`, never in git)

| Variable | Meaning |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs key (header `xi-api-key`) |
| `ELEVENLABS_AGENT_ID` | R2's agent |
| `ELEVENLABS_PHONE_NUMBER_ID` | our Twilio number as imported into ElevenLabs |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio REST: call status, price, hang-up |
| `TELEPHONY_ALLOWLIST` | comma-separated E.164 numbers whose owners agreed to be called |
| `TELEPHONY_ALLOWLIST_FILE` | the same, one per line, e.g. `data/allowlist.txt` (gitignored) |
| `TELEPHONY_PRE_ARRANGED` | numbers that agreed in advance: logged as `pre_arranged: true`, may be called outside shop hours |

Real mode refuses to start if any of the first five is missing (`MissingSetting` names them, never their values).

R5's wiring: `TwilioElevenLabsCalls.from_env(build_client_data=<R2's builder>)` and
`R4RetryPolicy()`, behind `PROVIDER_MODE=real`.

## 3. Setup checklist (when access arrives)

- [ ] Twilio **paid** account. Trial accounts can't call unverified numbers.
- [ ] Twilio Voice geographic permissions: **Saudi Arabia enabled** (mobile and landline)
- [ ] A Twilio number (US for the prototype), imported into ElevenLabs. Record its `phone_number_id`.
- [ ] Keys in `.env`; R1 checks the spend against the $500 budget first (plan §4)
- [ ] Allowlist file with the teammates' and friendly shops' numbers, with their consent
- [ ] Save one real response of each kind (no personal data) into `tests/telephony/payloads/`, replacing the synthetic one, with `_note` starting `REAL`

## 4. Test plan and record

Every test is run by hand, behind the flag, to **allowlisted numbers only**. Fill in the result
and date, and never delete a row: a failed test stays on record.

| # | Test | How | Expected | Result | Date |
|---|---|---|---|---|---|
| T1 | Caller ID, US number | Call a teammate's Saudi mobile | Note exactly what is displayed (number, "unknown", spam label) and whether they would answer | not run | |
| T2 | Caller ID, Saudi number | Same, through Unifonic or another SIP provider (§5), if available | A local number is displayed | not run | |
| T3 | Saudi mobile, answered | Teammate answers and plays the shop | `human_completed`, transcript has `shop` turns | not run | |
| T4 | Saudi landline, answered | A friendly shop's landline | `human_completed` | not run | |
| T5 | No answer | Let it ring out | `no_answer` after about 30 s (ringing timeout) | not run | |
| T6 | Busy | Callee is on another call | `busy` | not run | |
| T7 | Rejected | Callee declines | `no_answer` (Twilio reports a rejected call as no-answer) | not run | |
| T8 | Voicemail | Phone off or voicemail on | `voicemail`; the agent leaves no message | not run | |
| T9 | Hang up at once | Callee answers and hangs up without speaking | `hung_up` | not run | |
| T10 | Hang up mid-call | Callee hangs up after the first answer | `human_partial` | not run | |
| T11 | Wrong business | Callee says it's a restaurant | `wrong_business` (needs R2's `call_outcome` item) | not run | |
| T12 | 920 number | An allowlisted 920 number, if one is available | `ivr`; the agent hangs up and navigates no menu | not run | |
| T13 | Not on the allowlist | Job to a number not on the list | Refused before any request (`NumberNotAllowed`) | offline test passes | 5 Nov 2026 |
| T14 | Cancel mid-call | Cancel the task during a call | Call ends within seconds (Twilio `Status=completed`) | offline test passes | 5 Nov 2026 |
| T15 | Retry | No answer, then answer 10 min later | One retry, same `call_id`, `attempt: 2` | offline test passes (mock pipeline) | 5 Nov 2026 |
| T16 | Outside calling hours | Non-pre-arranged number at night | Refused (`OutsideCallingHours`) | offline test passes | 5 Nov 2026 |
| T17 | Cost | Compare `cost_usd` with the Twilio and ElevenLabs consoles | Equal within a cent | not run | |
| T18 | Duration and timing | 150 s call, then post-call processing | Ends before the orchestrator's 210 s `call_timeout_s`; if not, tell R1 | not run | |
| T19 | Call-back to our number | Callee calls our number back | Logged against the right task (needs an inbound route from R5) | not designed yet | |
| **Smoke** | Activation (plan §4) | 3 calls to allowlisted numbers | All 3 give a valid `CallResult`, stored against a `TaskSpec` (Gate A) | not run | |

## 5. Saudi caller ID: Unifonic

Saudi carriers' SIP trunks need a commercial registration, so we asked Unifonic:

> *Can you provide an outbound SIP trunk with a Saudi caller ID that we connect to ElevenLabs Agents?*

| Asked | By | Answer | Date |
|---|---|---|---|
| email | R4 | waiting | |

If no Saudi caller ID is possible, we use the US number and record T1's effect on reach rate.

## 6. Assumptions to check on the first real calls

These are written from the docs and must be confirmed (or the code fixed) with real responses:

- ElevenLabs `metadata.phone_call.call_result` is filled in for Twilio calls, with the values `answered`, `voicemail`, `busy`, `no_answer` and `failed`.
- Twilio `answered_by` is `null`, because we don't turn on Twilio's machine detection. Voicemail comes from ElevenLabs.
- Twilio's `price` may still be `null` right after the call. The cost is then ElevenLabs' share only, so check T17.
- `metadata.cost_fiat` is in USD. Check whether it includes the LLM cost.
- Whether post-call processing (`status: processing`) finishes fast enough for T18.
- `language_final` is guessed from the script of the last turn (Arabic letters → `ar`, Latin → `en`). Replace it if ElevenLabs reports the detected language.
- Role-play calls: `scenario_id` is `null` from the provider. R3 sets it when labelling.

## 7. Budget

Twilio to Saudi Arabia costs about **$0.31/min for mobile** and $0.17/min for landline. ElevenLabs costs $0.08/min plus the LLM.
Budget at the mobile rate: a 2.5 min call is about $1.0. The task cost cap (`max_task_cost_usd`, $5) only blocks retries.

## 8. Demo fallback

If live calling fails on the day, R1 calls a pre-arranged shop from his own phone and merges in the agent's number (architecture §6 R4).
