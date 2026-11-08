# Response review — November 8, 2026

## What changed

- Butterfly plans use gray/dashed, purple/dotted and blue/solid identities across choices and tank traces. The red threshold is explicitly labeled as automatic shut-in, distinct from full tank capacity. Chart axes name tank percentage and time after the decision. Overlapping futures and truck-induced drops are explained.
- Open **Decision → consequences** to see each facility's visits, shared truck commitments at its shut-in time, selective well stops, automatic shut-in, repair time and lost revenue. Different outcomes are highlighted against the recommendation; the recommended branch compares against no action. **Show this moment** pauses and moves the animation to the corresponding event. Fleet contention alone is not presented as proof that every site could have been saved.
- **How this simulation works** explains mitigation versus repair, automatic shut-in, late trucks, modeled repair, field completion, and calculation versus playback. Truck schedules say **Available again at**, rather than the ambiguous **Free**.
- **Use this plan for approval** carries the selected, calculated future back to the chosen incident. Control still confirms the incident, chooses an available engineer, edits instructions and explicitly sends it. The backend re-simulates the supplied plan against the session-owned latest recording. It rejects stale/wrong-system plans and impossible schedules. The approved plan and instructions persist with the assignment and audit event. Retrying the same approval does not notify twice; changing a previously submitted plan is not treated as an identical retry.
- The investigator chooses tools for the question. Rules questions no longer require a cost comparison. Answers lead with an explanation; supporting facts and plan tables are expandable. Invalid model prose gets a bounded correction request rather than being silently replaced with a recommended-plan dump. Actual simulated alternatives show exact server-calculated cost and facility differences in the answer. The model has no field approval or equipment-control tools.

## Verification

- Unit/integration suite: 33 passed; the PostgreSQL test is skipped locally without its dedicated test database. CI runs that test against PostgreSQL.
- Browser suite: 17 passed, including custom plan → control approval → assigned phone inbox → acknowledgment → completion, simulation controls, forecast stability, phone widths, AI form interaction and disclosure behavior.
- Official input rehearsal: imported network.json, ops.json and telemetry.csv from the supplied October 8 snapshot through the browser; reviewed pump failure, pump degradation and pipeline leak; calculated a feasible manual alternative with NVIDIA disabled. Separate tests import previously unknown asset/system IDs. This is generalization rehearsal, not a claim to have seen the judges' private dataset.
- Offline reference validation: full-week 23 episodes; zero missed/extra reference events or active-set mismatches. EVENT_9 and shared-fleet plan checks pass. Answer keys are used only by offline reference validation, never by the running app.
- Live NVIDIA hosted inference: repair-versus-truck, late-arriving truck, field completion, the original S2 incident and two-trucks-to-one-facility questions completed with actual tool calls. In the S4 comparison the proposed plan cost $7,469.18 versus $3,082.65 for the best found, a $4,386.53 difference. It prevents automatic shut-in at Facility A while allowing it at C and D relative to the recommendation. These are computed results, not a scripted advantage. Malformed tool-call structure gets one retry before any rejected calls are executed; bounded answer corrections were exercised in real inference.
- Production build and TypeScript checks pass. The existing Three.js large-chunk advisory remains.
- Real mobile push delivery: the developer reported successfully receiving push notifications on their phone. Automated browser permission/push tests remain mocks; real VAPID encryption/signing has a separate test. We have not inferred a particular phone OS/version or repeated that physical-device test in this change.

## Demo sequence

1. Import the three supplied files. Select an alert and explain its sensor evidence; distinguish inspection incidents from complete pump failures.
2. On a failed pump, open Butterfly Effect. Read the no-action cost and threshold before selecting the recommended future.
3. Add a plausible truck or well alternative. **Run simulation** computes it. Read the cost difference, open **Decision → consequences**, and use **Show this moment** or **Next event** to demonstrate the ripple. **Play** is only animation.
4. Optionally ask the AI about that decision. Expand supporting evidence or tool calls when challenged; the calculation works without NVIDIA.
5. Select the desired future and facility, then **Use this plan for approval**. Confirm, select the clocked-in engineer and review instructions before sending. The phone receives only an approved assignment.
6. Acknowledge and report findings on the phone. Completion means work was reported complete, not that historic sensor data changed. Only subsequent recorded evidence can clear a recorded fault; modeled repair affects simulated futures.

## Remaining limits

The optimizer reports best found within its bounded candidate search. AI prose is still model-generated and needs operator review; numeric facts and compared outcomes come from deterministic tools, and invalid answers can fail honestly after retries. The pending approval selection is browser state until sent; reloading before approval discards it. Persisted assignments survive reload. An assignment concerns the selected facility; it stores the shared system simulation but does not physically dispatch trucks or coordinate a real fleet. Demo identities are synthetic. Public phone access still depends on the running HTTPS tunnel/deployment and phone permissions.
