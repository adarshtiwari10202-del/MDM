# MDM Monitoring Dashboard — Notes

*Mid-Day Meal monitoring pilot · Hargaon block, Sitapur · CSF / DPMU, Nipun Bharat*
*Status: live pilot build · Last updated: 14 Sep 2026*

---

## 1. What this is

An AI-assisted monitoring system for the Mid-Day Meal (MDM) programme. Schools
self-report each day's meal through a few photos and a short video; the system
screens every submission automatically, a human reviewer judges what the machine
cannot, and the result feeds a daily priority list of schools to visit.

**In one line:** *AI screens every meal, a human decides, physical visits confirm.*

The dashboard is the reviewer's workspace — it shows every school's daily
submission, what the AI observed, the flags raised, and lets the reviewer record
the verdict that goes on record.

---

## 2. The guiding principles (non-negotiable)

These are built into the system, not just policy on paper:

1. **Monitor the meal, not the teacher.** No faces are required. There is no
   facial recognition, ever. If a photo clearly shows a face, the submission is
   treated as invalid — schools are told this.
2. **AI observes, humans judge.** The AI only reports *what is visible* (which
   dishes, whether food is present, the scene). It **never** decides
   "acceptable / not acceptable." Only the reviewer does. No AI flag reaches a
   school — only a mentor's verified finding.
3. **Cost-controlled by design.** Video is shrunk to low resolution before the AI
   sees it; each photo is analysed once and its reading stored, so later
   comparisons never re-scan images.

---

## 3. What a school submits each day

By ~11:30 AM on every school day, via a Google Form:

| # | Item | Purpose |
|---|------|---------|
| 1 | Photo: cook cooking (kitchen visible) | Cooking is genuinely happening |
| 2 | Photo: cooked meal in the vessel (top-down) | Which dishes were made |
| 3 | Video: 10–12 s of serving onto a plate | Food is actually served |
| 4 | Photo: children eating (wide angle, no close-ups) | Children are being fed |

Plus school name, UDISE code, date, and how many children ate.

---

## 4. What the dashboard shows

- A **ranked review queue** — the most-flagged submissions first, so the
  reviewer's attention goes where it matters.
- For each submission: the **four media items inline**, the **AI's reading**
  (dishes seen, whether children are eating, GPS/time read off the photo stamp),
  and the **flags** raised.
- **Reviewer controls** — mark each meal *Acceptable* / *Not acceptable* and add
  a comment. This verdict is saved and is what goes on record.
- **Summary tiles** — total submissions, red flags, amber flags, how many are
  awaiting review, and the share with no flags.

---

## 5. How to read the flags

Flags are **signals for the reviewer**, not verdicts.

- 🔴 **Red** — a likely real problem (something missing, not matching, or wrong).
  Sorted to the top of the queue.
- 🟡 **Amber** — worth a glance (usually a timing or scene nuance).
- 🟢 **Clean** — no automated flags.

The reviewer always makes the final call; a red flag is a prompt to look, not a
conclusion. (The full list of what triggers each flag is in the *Analysis &
Flagging Framework* document.)

---

## 6. What's live today

- Schools submit via the live Google Forms.
- Every submission is processed automatically each evening (8 PM) — AI reading +
  automated flags — and written to a results store.
- The dashboard is hosted on the web (same setup as the NIPUN dashboard) and
  reads that store; reviewer verdicts save back to it.
- Real submissions from Hargaon are flowing through end-to-end.

---

## 7. Privacy & data

- No faces are required or used; face-visible submissions are invalid by rule.
- Photos/videos stay in the programme's Google Drive; data in Google Sheets.
- The dashboard reads media through a secure server account — images are not made
  public.

---

## 8. What's coming next (in design)

- **Baseline-aware checks** — judge portion/quantity against each school's own
  recorded vessel sizes and enrolment.
- **Peer comparison** — compare a school against others cooking the same menu the
  same day.
- **Richer image prompts** — more detailed, menu- and baseline-aware analysis.
- **Daily digest** — an automatic summary to leadership with the day's priority
  schools.

---

## 9. Budget context

3-month pilot approved at ₹60,000; realistic spend ₹15–20k. The cost lever
(shrinking video before AI) keeps AI processing well within budget. No extra
cloud storage is needed for the pilot — media stays in Google Drive.

---

*Questions or access requests: contact the pilot lead (Adarsh, CSF / DPMU Sitapur).*
