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

Choose **Import data** and select `network.json`, `ops.json`, and `telemetry.csv` together to load a judging dataset. The topology and analysis rebuild from those files. **List** provides the same equipment and alert controls without WebGL.

## Demo walkthrough

1. Open the full week and choose **Start Demo**. The recording starts with normal operations.
2. Choose **Replay the lead-up**. The playhead pauses on the first pump fault. Inspect its recorded evidence, tank headroom, and time to the shutdown limit.
3. Choose **Show shared fleet pressure**. The replay pauses when three pumps in the same system are down. The alert queue shows the response calculated for each facility.
4. Choose **Compare responses**. The Decision Lab compares a priority-based truck assignment with a shared-fleet recommendation and the no-action baseline. Play the paired maps, then inspect the tank and well outcomes and the oil, gas, and trucking costs.
5. Close the lab and switch to a snapshot or import a different topology.

## How the numbers work

- `src/engine/load.ts` validates topology, operating parameters and telemetry. The latest telemetry timestamp is the dataset clock. Recorded readings stay separate from simulation results.
- `src/engine/incidents.ts` identifies a pump failure from the fault status. Wear requires three consecutive running samples at least 2.5% below rated flow. A leak requires three running samples with at least 1.2% flow loss and a 12 psi receiving-pressure deficit. After two hours without a running sample, a previously flagged leak moves to **Awaiting verification** until flow provides new evidence.
- `src/engine/simulate.ts` starts from measured tank fill and uses configured well rates. It calculates the exact time when the tank reaches its limit, applies truck removals at arrival, and enforces shut-in through repair. A truck becomes available again after its final return. Oil and gas revenue losses use configured production rates and prices.
- `src/engine/optimize.ts` compares no action with joint fleet schedules and selective well shut-ins. Its search uses earliest available dispatches, groups of wells shut in together on five-minute boundaries, and a fixed search budget. The recommendation is the least-cost feasible plan found in that search. The manual editor supports later dispatches and staggered shut-ins.
- `src/scene/` projects provided coordinates into a schematic low-poly world. Recorded telemetry drives tank fill, pump state and flow. Decision Lab truck positions interpolate between simulated schedule events for playback.

## Optional NVIDIA Nemotron

The [Nemotron endpoint](https://docs.api.nvidia.com/nim/reference/nvidia-nemotron-3_5-super-vl-120b-a12b-infer) can investigate a frozen Decision Lab snapshot. Set `NVIDIA_API_KEY` in the local environment or in an ignored `.env.local`, then restart `npm run dev` or `npm run preview`. The key stays in the loopback server bridge.

Select **Investigate with Nemotron** in the lab to send the selected system's evidence and computed outcomes to NVIDIA. The tool log shows incident lookup, sensor queries, forecasting, and plan comparison as requested by the model. The deterministic engine supplies the measurements and costs. The browser tests and simulator run with the optional integration disabled.

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
