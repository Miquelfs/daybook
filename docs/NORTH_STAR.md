# Daybook — North Star

**Purpose of this document:** The long-range vision for Daybook, beyond the phased roadmap. Claude Code sequences and design docs should reference these horizons by name. This is not a build spec — it is the direction of travel.

**Core thesis:** Daybook climbs a ladder: **record → model → instrument.**
A record tells you what happened. A model tells you why. An instrument changes what you do tomorrow. Phases 0–2 built the record. Everything that matters next is the climb.

**Last updated:** June 2026

---

## Horizon 1 — The Personal Load Model

*The thing no product on Earth can build, because no product has this data.*

Airlines run biomathematical fatigue models (SAFTE-FAST, Three-Process Model of Alertness) on population averages. Daybook has something better: years of one person's HRV, sleep stages, resting HR, subjective energy, duty days, timezone offsets, and training load — on a single date key.

**The build path:**

1. **Load Index (embryo).** A nightly composite metric computed from sleep debt, timezone displacement, consecutive duty days, and training stress. Stored in `daily_values` like any other metric, so the correlation engine treats it natively.
2. **Validation.** Does the index predict reported energy/mood at lag-1 and lag-2? Use existing questionnaire data as ground truth. Iterate the weights until it does. (The correlation engine's lag-1 Pearson is literally the first derivative of this model.)
3. **Roster import → prediction.** Once validated, feed the *future* roster in. Daybook flags before the month begins: "this earlies-into-westbound-layover pattern historically costs you ~15 HRV points and three low-energy days."
4. **Ironman convergence.** The same model is a **race-readiness model**. Training load (Garmin) + sleep + HRV + duty schedule = the answer to "can I absorb this week's training block, or will duty wreck it?" Plan-vs-actual compliance (existing `training_plans`/`planned_workouts` design) closes the loop: prescribed load vs. executed load vs. recovery cost.

**Done when:** Daybook predicts a bad week before it happens — for duty *or* for training — and is right more often than not.

---

## Horizon 2 — The Memory Machine

*Semantic recall over a life, fully local.*

When Ollama lands (Phase 4), the obvious use is NL-to-SQL. That is the *least* interesting use. The interesting one is **embeddings**.

- Every journal note, daily answer, decision entry, and transcribed voice memo gets a vector via a small local embedding model.
- Storage: **sqlite-vec** inside the existing daybook.db. No new database, no new service. Boring-tech compliant.
- "On this day" stops being a date lookup and becomes semantic recall: *"when did I last feel like this?"* — *"show me days like today"* — *"what was I worried about the last time I made a big decision?"*

**The moat is corpus density, not the model.** Every reflection written in 2026 is training data for the system of 2030. Consequence: the evening questionnaire and a **layover audio diary** (30 seconds into the phone, Whisper-transcribed nightly) are the highest-leverage habits in the entire project.

**Done when:** Daybook can answer a question about your inner life that you could not answer from memory.

---

## Horizon 3 — The Experimentation & Calibration Engine

*From observing your life to running it deliberately. This is the anti-self-sabotage instrument.*

### N-of-1 experiments
Correlations are passive and confounded forever. The honest upgrade:

1. The correlation engine surfaces a hypothesis ("alcohol on layovers ↔ −12 HRV").
2. You commit to a protocol (3 weeks, defined condition, washout period).
3. Compliance tracked via existing tags; outcome measured with existing Cohen's d machinery.
4. Result: a personal effect size, not a vibe.

Schema cost: one `experiments` table. The math already exists in the tag engine.

### Decision log with calibration
Log decisions **with a predicted outcome and a confidence level**. Daybook resurfaces each one at its horizon date and asks: what actually happened? Over years this produces a **personal calibration curve** — whether your "80% sure" means 80%. This is the single most concrete tool Daybook offers against being your own blockage: it converts self-doubt and self-belief alike into measurable, improvable quantities.

### Goals with teeth
Goals (migrating from Notion) stop being a list and become **commitments with review dates**. The Sunday weekly review asks three questions, automatically, with data attached:
- Did I do what I said I would? (plan-vs-actual, tags, training compliance)
- What did I decide this week, and what did I predict?
- Did I use Daybook, or just build it?

**Done when:** A goal set in Daybook is measurably more likely to be completed than a goal set anywhere else — because the system follows up and you can't quietly forget.

---

## Horizon 4 — The Anticipatory Daybook

*Everything above is still reactive. The endgame looks forward.*

- Roster import drives predicted load (Horizon 1).
- Arriving at a layover city surfaces what you did, ate, and felt there before (Horizon 2).
- The weekly review stops summarizing and starts **briefing**: "here's what's coming, here's what your history says about it, here's what you committed to."
- The Today view eventually splits: *what happened* / *what's coming*.

---

## The Long Arc — Archival as a Feature

Per the 20-year principle:

- **Yearly cold export:** entire database emitted as Parquet + a self-describing schema document, to offline storage. The data must outlive SQLite itself if necessary.
- **Year in Review artifact:** a generated, designed document each January — the proof-of-life of the project, and the best argument to yourself for continuing it.

---

## The Builder's Layer (new)

Daybook's owner wants to build a business. Daybook is **not the business** — it was explicitly designed as not-a-product, and that constraint is why it's good. But it serves the ambition three ways:

1. **As the operating system for building.** The decision log, calibration curve, goals-with-teeth, and weekly briefing are exactly the instruments a founder needs and almost never has. Run the future business's decisions through the same machinery.
2. **As proof of work.** A shipped, multi-domain, local-first system with real pipelines and real statistics is a portfolio that very few pilots — and few engineers — can show. It demonstrates the rarest founder skill: finishing.
3. **As a pattern detector for the opportunity itself.** The intersection that produced Daybook (pilot + engineer + data ownership) is the same intersection where a viable business most likely lives. Aviation is full of underserved, technically conservative niches visible only from inside the flight deck. Daybook's job is to keep the signal log running until one of those problems repeats often enough to be undeniable.

**Rule:** the open question "should Daybook ever be a product?" is re-asked once per year, in the Year in Review, and not before.

---

## Sequencing & Guardrails

1. **Data density before models.** The Load Index needs months of questionnaire compliance. If compliance drops, fix friction before building anything above it.
2. **Order of operations:** correlation engine ships and runs 2–3 months → Load Index + roster import → sqlite-vec embeddings as the *first* Ollama use case → experiments & calibration once tags have proven daily usage.
3. **The Pi test:** any feature requiring a new service, a GPU, or a dependency you wouldn't trust on a Pi in 2046 is probably the wrong feature. The moat is that the data is *yours*, *dense*, and *aviation-shaped* — not that the stack is sophisticated.
4. **The Sunday question stays supreme:** "Did I use it this week?" If no — stop building, start using.
