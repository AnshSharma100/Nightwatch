# NIGHTWATCH · Field Atlas

NIGHTWATCH helps a control-room operator understand a produced-water network, forecast automatic well shut-ins, compare simulated responses, and dispatch approved field work. It was built for the HackUTD 2026 EOG Resources challenge. [EOG challenge and simulation specification](https://github.com/nihaal419/HackUTD-ZeroDay/blob/main/SPEC.md)

## Run locally

Use Node.js 24 and Git. On Windows, use `npm.cmd` when PowerShell restricts script execution.

```sh
npm ci
npm run data
npm run dev
```

Open the URL printed by Vite. The development command mounts the same Node API inside Vite. It uses the local workflow file unless `DATABASE_URL` is set. To run separate processes, open two terminals after building.

```powershell
npm.cmd run build
npm.cmd run api
```

```powershell
$env:NIGHTWATCH_API_ORIGIN = 'http://127.0.0.1:4100'
npm.cmd run preview -- --port 4180
```

Open [Operations](http://127.0.0.1:4180/) or [NIGHTWATCH Field](http://127.0.0.1:4180/field). The browser sends API calls through the frontend origin. The standalone API exposes `/api/health/live` and `/api/health/ready`.

`npm run data` fetches or uses an adjacent copy of the official **practice** recordings and stages the three runtime files. To exercise a new EOG dataset, use **Import** and select its `network.json`, `ops.json`, and `telemetry.csv` together. Imported recordings are saved privately on the API server. The importing browser can reopen its Decision Lab link while its recording cookie is valid. WebGL failure automatically switches the operations view to the accessible equipment list and the lab to synchronized schematics.

## Two-minute demonstration

1. Open the full-week recording. Start the guided replay or use **Recent recorded incidents** to jump from a calm latest timestamp to a real alarm.
2. For the shared-fleet example, choose the **Oct 10, 09:00 UTC** snapshot. Select `S4_PUMP_A`. Show the recorded fault evidence, the forecast, and the separate hourly risk and projected loss.
3. Open **Compare response plans**. Choose a plan to preview on the simulated 3D network. Add a truck job or well stop and run it. Switch to **Compare schematics** for simultaneous playback. The recommendation is the lowest cost found within the search described in the evidence pane.
4. Open **AI Investigator** on the incident. Ask why both trucks should or should not go to Facility A. Expand the tool trace and compare the computed outcome with the answer.
5. Review and confirm the incident. Pick a clocked-in engineer, enter the approved instructions, then select **Send to Field**. On a separate enrolled browser, open the assignment from the inbox or notification, acknowledge it, and post a progress note. Show the control room receiving the update.
6. Import a second EOG recording or switch to the no-key mock test snapshot to show dynamic topology and recalculated results.

Prepare the enrolled device and NVIDIA sign-in before the demo. If the network is unreliable, keep the local simulator open and use the recorded evidence, screenshots, or inbox to explain the parts that depend on a provider.

## Field setup and phone testing

Run `npm run setup:field` once to generate a local control code and VAPID keypair in the gitignored repository-root `.env.local`. Restart the API afterward. Sign in as control, start an incident review, then open **Enroll a demo field device**. Create a one-time invite for the facility engineer or a system engineer. The identities are synthetic and their coverage comes from the loaded topology.

- Open `/field` on a separate device or browser profile and enter the invite within 15 minutes. Tap **Clock in** to become available. **Busy** keeps the shift open and disables new dispatch. A shift ends after eight hours or when its session expires, whichever comes first. Clocking out preserves inbox access.
- Select **Enable notifications** from Field when ready. Use the same HTTPS site on both devices. On supported iOS and iPadOS versions, install the site with **Add to Home Screen**, launch that Home Screen app, then enable notifications inside it. Desktop loopback is useful for local testing. A phone needs a reachable HTTPS origin. [WebKit iOS and iPadOS Web Push guide](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- For a phone demo, use an HTTPS deployment or run `cloudflared tunnel --url http://127.0.0.1:4180`, set `NIGHTWATCH_PUBLIC_ORIGIN` in `.env.local` to the exact assigned HTTPS origin, and restart the API and preview. Use this URL for both operator and field sign-in. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
- Approval queues one delivery to the selected engineer’s currently available enrolled devices. Delivery status reports whether the push service accepted the request. The worker’s acknowledgment has its own timestamp. The inbox remains available if permission is declined or a device lacks push support.

## NVIDIA Nemotron

Put the key and API URL in **`.env.local` at the repository root**. Restart the API after a change.

```dotenv
NVIDIA_API_KEY=
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=nvidia/nemotron-3.5-super-vl-120b-a12b
```

`npm run test:nvidia` exercises live function calling on the official S4 snapshot. It requires a successful simulated alternative and comparison and prints the model’s explanation alongside the tool-derived costs. The core operations and field workflows run independently of NVIDIA. [NVIDIA Build model](https://build.nvidia.com/nvidia/nemotron-3.5-super-vl-120b-a12b)

## Docker and storage

With Docker and Compose installed, run `docker compose up --build`. The default stack publishes the unprivileged frontend on loopback and runs the API and PostgreSQL on the private Compose network. The build prepares the pinned official EOG practice data. Named volumes hold PostgreSQL records and imported raw bundles across restarts. Field and NVIDIA settings are loaded from `.env.local` at runtime. To shut down and keep data, use `docker compose down`.

For a production-profile deployment behind a trusted TLS reverse proxy, set `NIGHTWATCH_PUBLIC_ORIGIN` to the external HTTPS URL and `NIGHTWATCH_DB_PASSWORD` to a long URL-safe value in the shell or gitignored `.env`. Forward the original Host header. The production profile requires control-room sign-in for new imports.

```sh
docker compose -f compose.yaml -f compose.production.yaml --profile production up --build
```

To migrate an existing local workflow into an empty PostgreSQL schema, run the API once with both `DATABASE_URL` and `NIGHTWATCH_LEGACY_WORKFLOW_FILE=.nightwatch/workflow.json` set. Keep the original file as a backup. The migration is recorded once. For Compose, mount the legacy file read-only and set the variable to its path inside the container.

[Architecture and operating limits](ARCHITECTURE.md) · [Third-party software and data](THIRD_PARTY.md)

## Verification

```sh
npm test
npm run validate:eog
npm run validate:plans
npm run build
npm run test:browser
npm run test:nvidia
```

Set `NIGHTWATCH_TEST_DATABASE_URL` to a **test** PostgreSQL instance for the migration and concurrency test. It creates a temporary schema. Set `NIGHTWATCH_TEST_SPLIT=1` and `DATABASE_URL` to a fresh browser-test database to run Playwright through the standalone API and built frontend. Browser tests use Chrome by default. Set `NIGHTWATCH_BROWSER=msedge` for Edge. The notification tests use mocked browser permission and push transport plus real VAPID signing and payload encryption. Installed-phone notification display requires a separate device test.

Offline EOG validation reads the upstream answer keys only in the reference checkout. The full week produces 23 matching incident episodes. EVENT_9 yields $4,991.36 at the recorded tank level versus $5,016.00 at the reference’s rounded starting level. The selective shut-in and truck alternatives yield $1,958.33 and $905.00 using the same simulator.

## AI assistance

The project owner supplied the concept, design direction, requirements, and sponsor context. Codex assisted with code, design implementation, tests, and documentation. [HackUTD ZeroDay submission rules](https://hackutd-zeroday.devpost.com/rules)
