# NIGHTWATCH — Build Order and Test Gates

## Gate A — Dataset and shared types (start here)
- Create new repo with frontend and backend (suggest React/Vite/TypeScript/Three.js + Python/FastAPI, or all TypeScript if strong reason).
- Clone/copy EOG reference challenge into read-only `reference/eog/` or link it as external read-only data; never edit source challenge content.
- Parse and validate three-file folder, derive timestamps, asset registry, topology, costs, truck parameters, and initial state.
- Support all practice folders through a unified loader; no answer key ever reaches runtime.
- Add `GET /api/datasets`, `POST /api/datasets/load`, `GET /api/network`, `GET /api/alerts?at=...` as appropriate (or equivalent API), and unit tests. API names illustrative.
- Gate: print and/or show every system and facility discovered from practice JSON and successfully load no-answer-key mock_test.

## Gate B — Incidents and clarity-first console
- Implement sustained-evidence rules for leak, degradation, failure. Avoid false alarms from normal off cycles.
- Build always-visible incident list sorted per SPEC (pump failures by soonest threshold, tie by revenue; then inspections).
- Facility detail: raw sensor traces, evidence, current level, 'recorded' labels.
- Gate: compare detections to practice answer keys offline; show measured FP/FN, correct any major errors.

## Gate C — Dynamics and decision engine
- Implement 5-minute state evolution for tank capacity, inflow, outflow, early/automatic shut-ins, repairs, truck trip arrivals and return/availability.
- Run no-action baseline; enumerate plausible truck counts/trips and well shut-in combinations for small networks; use an optimizer if combinatorics grow.
- Enforce **system-wide** truck constraints and timelines; quantify cost components.
- Gate: EVENT_9 reproduces documented approximate reference costs; S2/S4 multi-failure snapshot allocations never exceed fleets; decisions don't affect immutable telemetry.

## Gate D — 3D environment and demo
- Procedurally create a low-poly scene from normalized network entities, not hardcoded S1/S2 object graphs.
- Show tanks filling, running/stopped/fault pumps, pulsing directional pipelines; clicking asset opens detail panel.
- Guided camera transitions, historical time slider, 'Start Demo' sequence on a real practice event.
- Gate: switching to mock_test and then unseen test changes topology and telemetry without manual edits; UI remains intelligible with WebGL disabled.

## Gate E — Sponsor extensions
- Real Nemotron model tool orchestration: retrieve event -> inspect evidence -> query forecast -> compare candidate actions -> explain. User approval before simulating an action plan as 'chosen'. Test against tool failures.
- Optional MLH Tiger Data as query backend for time-series; demonstrate actual queries/benefit.
- Gate: have separate sponsor-specific 90-second demos, with evidence of meaningful technology usage.

## Gate F — Final validation and submission
- Exercise all provided snapshots and no-answer-key mock_test.
- Live-test a changed network topology and new/extra facilities, unknown IDs, different truck counts, no active incidents, noisy inputs.
- Clean demo story: warning -> evidence -> what happens untreated -> trade-offs -> recommendation -> test-data import.
- Document architecture and assumptions; rehearse clear answers to: Why did this alert fire? Why this action? What if the model is wrong? Why this 3D view? Where is the data sourced?
- Confirm EOG/NVIDIA/MLH submission requirements and AI-code policy from the current organizer instructions.
