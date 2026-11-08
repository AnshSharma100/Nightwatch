# NIGHTWATCH

NIGHTWATCH is a night-shift console for the [EOG Resources Beat the Shutdown challenge](https://github.com/nihaal419/HackUTD-ZeroDay). It reads produced-water telemetry, flags faults, forecasts well shut-ins, and compares intervention plans across facilities sharing an emergency fleet.

## Run locally

Use Node.js 24 and Git. In PowerShell, use `npm.cmd` if script execution is restricted.

```sh
npm ci
npm run data
npm run dev
```

Open the local URL printed by Vite. In this workspace the practice data is already prepared. On a new checkout, `npm run data` fetches the official source or uses an adjacent `.eog-reference` checkout. It copies only the three operational files per dataset into the local public directory. Supply an updated EOG checkout with `npm run data -- /path/to/HackUTD-ZeroDay`.

Choose **Import data** and select `network.json`, `ops.json`, and `telemetry.csv` together to load a judging dataset. The topology and analysis rebuild from those files. **List view** provides keyboard-accessible equipment navigation and is selected automatically when WebGL is unavailable.

## Demo walkthrough

1. Open the full week and choose **Start Demo**. The recording starts with normal operations.
2. Choose **Replay the lead-up**. The playhead pauses on the first pump fault. Inspect its recorded evidence, tank headroom, and time to the shutdown limit.
3. Choose **Show shared fleet pressure**. The replay pauses when three pumps in the same system are down. Select a priority alert to see its evidence, forecast, and recommended response in the inspector.
4. Choose **Compare responses**. The Decision Lab compares a priority-based truck assignment with a shared-fleet recommendation and the no-action baseline. Play the paired maps, then inspect the tank and well outcomes and the oil, gas, and trucking costs.
5. Close the lab and switch to a snapshot or import a different topology.

## How the numbers work

- `src/engine/load.ts` validates topology, operating parameters and telemetry. The latest telemetry timestamp is the dataset clock. Recorded readings stay separate from simulation results.
- `src/engine/incidents.ts` identifies a pump failure from the fault status. Wear requires three consecutive running samples at least 2.5% below rated flow. A leak requires three running samples with at least 1.2% flow loss and a 12 psi receiving-pressure deficit. After two hours without a running sample, a previously flagged leak moves to **Awaiting verification** until flow provides new evidence.
- `src/engine/simulate.ts` starts from measured tank fill and uses configured well rates. It calculates the exact time when the tank reaches its limit, applies truck removals at arrival, and enforces shut-in through repair. A truck becomes available again after its final return. Oil and gas revenue losses use configured production rates and prices.
- `src/engine/optimize.ts` compares no action with joint fleet schedules and selective well shut-ins. Its search uses earliest available dispatches, groups of wells shut in together on five-minute boundaries, and a fixed search budget. The recommendation is the least-cost feasible plan found in that search. The manual editor supports later dispatches and staggered shut-ins.
- `src/scene/` projects provided coordinates into a schematic low-poly world. Recorded telemetry drives tank fill, pump state and flow. Decision Lab truck positions interpolate between simulated schedule events for playback.

## NIGHTWATCH Field and Web Push

In the repository root, run `npm run setup:field`. It creates or updates the ignored `.env.local` with a generated control-room code and VAPID key pair. Keep the same key pair for devices already subscribed. Set `VAPID_SUBJECT` to a monitored contact email. Restart the server after editing the file.

1. Open NIGHTWATCH, choose an incident at the latest recorded timestamp, and sign in using the value of `NIGHTWATCH_CONTROL_CODE` from `.env.local`.
2. Open **Incident workflow** and choose **Begin review**. Expand **Enroll a demo field device**, select the synthetic foreman or lease operator, and create a one-time code. Share it directly with that device. The code expires after 15 minutes and can be redeemed once.
3. Open `/field` in a separate browser profile or on the phone, sign in with the code, open **Notifications**, and tap **Enable notifications**.
4. In the control room, enter a confirmation reason and confirm. Choose the exact recipient, edit the instructions, then choose **Approve and notify**. The approved response comes from the same deterministic recording and planner.
5. Open the notification or the inbox. The assignment link loads its current authorized state from the server. Acknowledge it and post progress or findings. The desktop and field views poll the same backend every four seconds. A foreman may hand off to the synthetic lease operator for that facility.

The assignment and notification have separate statuses. **Accepted by push service** records a successful provider response. Worker acknowledgment is a separate authenticated action. A missing or rejected subscription leaves the assignment in the inbox. Expired subscriptions are removed. A request interrupted after send starts remains marked as acceptance unconfirmed and is not automatically resent.

### Phone testing over HTTPS

The laptop's `127.0.0.1` serves the laptop only. For a disposable demo using public EOG practice data, run `cloudflared tunnel --url http://127.0.0.1:4180` in a separate terminal. Copy the printed HTTPS origin into `NIGHTWATCH_PUBLIC_ORIGIN` in `.env.local` and restart `npm run preview -- --port 4180 --strictPort` while keeping the tunnel open. Open the HTTPS origin on the laptop for the control room and open its `/field` path on the phone. A new tunnel hostname needs a fresh sign-in and push subscription. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

On iPhone or iPad with iOS or iPadOS 16.4 or later, open `/field` in Safari and use **Share → Add to Home Screen**. Open the installed app, sign in, and tap **Enable notifications** there. The inbox also works from the browser. The browser automation suite uses a mocked Push API and a mocked provider transport. A physical iPhone delivery and lock-screen check is a separate manual test. [WebKit installation and push requirements](https://webkit.org/blog/13878/)

This prototype uses one local Node process and the ignored `.nightwatch/workflow.json` store for assignments, audit history, hashed session and enrollment tokens, subscriptions, and delivery status. The directory represents synthetic roles, with one control account and scoped field codes. Use one server process per store. An HTTPS tunnel exposes the workspace's public practice data and sign-in surface to anyone who can reach the URL. Use disposable demonstration data and identities for a tunnel.

## NVIDIA Nemotron

Open the ignored **`.env.local` file in the NIGHTWATCH repository root**. Set the following values and restart NIGHTWATCH:

```dotenv
NVIDIA_API_KEY=your_key_here
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=nvidia/nemotron-3.5-super-vl-120b-a12b
```

The base URL and model have these defaults. Generate the key in NVIDIA Build. Keep the key in the server environment or `.env.local`. [NVIDIA Build model and key setup](https://build.nvidia.com/nvidia/nemotron-3.5-super-vl-120b-a12b)

Sign in to the control room and open **AI Investigator** in the inspector or Decision Lab. Try **Test two trucks here** on the S4 snapshot. The server parses the selected recording and scopes it to the signed-in session. Nemotron chooses tools for evidence, sensor history, forecasts, fleet availability, optimization, alternative simulation, and comparison. The simulator supplies the numeric results. The trace is expandable, and a briefing can be copied into an editable assignment draft for operator approval. Running an investigation sends the selected system's requested evidence and computed outcomes to NVIDIA.

Run `npm run test:nvidia` after configuring the key to exercise the hosted endpoint with a real EOG snapshot. Its output reports completed tool names and the model identifier. Unit tests use a controlled model transport. The EOG console, simulator, assignments, and Web Push operate independently of NVIDIA.

## Verification

```sh
npm test
npm run validate:eog
npm run validate:plans
npm run build
npm run test:browser
```

Browser checks use an installed Chrome. Set `NIGHTWATCH_BROWSER=msedge` to use Edge. Offline validation reads upstream answer keys from the reference checkout. It checks the full-week incident count, the three labeled snapshots and the two-truck fleet cases, and loads the no-key mock dataset.

For EVENT_9, the recorded 49.93% initial tank reading yields $4,991.36 without action. Starting at the reference example's 50% yields $5,016.00. Both the $1,958.33 selective shut-in and $905.00 truck plan use the same simulator.

## Credits and AI disclosure

NIGHTWATCH uses React, Vite, TypeScript, Three.js, React Three Fiber, Drei, Lucide, and Playwright. Network data and operating rules come from the EOG challenge repository. The project owner supplied the concept, design direction, requirements, and sponsor context. Codex assisted with code, design implementation, tests, and documentation. See the [HackUTD ZeroDay submission rules](https://hackutd-zeroday.devpost.com/rules).
