# NIGHTWATCH — Visual and interaction direction

This is based on the user's three provided images and interactive portfolio. They are **inspiration**, not assets to copy verbatim or ship as proprietary artwork.

## Source images
- `visual_references/reference_01_low_poly_network.png`: cheerful isometric industrial world. Key traits: clear ground platform, readable buildings and tanks, roads, pipe connections, natural muted greens, simple forms, wide cinematic network view. Do **not** add train lines, offshore rigs, or unrelated industry elements to the operational model merely because they appear in this reference.
- `visual_references/reference_02_simple_low_poly_facility.png`: small compact scene with earthy tan/ochre materials, simple elevated tanks and clean geometry. Key traits: approachable low-poly shapes, self-contained facility tiles, disciplined color palette.
- `visual_references/reference_03_data_rich_command_center.png`: technical perspective of pipes/pumps/tanks integrated with metrics, panels and time-series charts. Use the composition and meaningful highlighting, **not** the overly saturated neon, dense info clutter or illegible small charts.
- Interactive portfolio mood reference: https://anshsharma100.github.io/portfolio/?place=personal — explore it if browsing is available; otherwise follow images and this brief. The desired feel is smoothly navigable, personal, low-poly, spatial, responsive, and inviting.

## Required aesthetic
- Stylized low-poly / isometric-ish interactive 3D. NOT photorealism. NOT a sci-fi hologram or an all-neon cyberpunk interface.
- Use an intentional palette: midnight/navy or slate UI, off-white readable text, muted teal for water, soft greens for healthy, warm amber for caution, restrained coral for critical. Low-opacity glow only where it communicates a changed state.
- Rounded but not cartoonish shapes, nice ambient/hemisphere lighting, subtle shadows, smooth camera glides/easing, legible labels, generous negative space.
- Use actual asset topology: wells -> tank -> pump -> outgoing pipeline -> system disposal, emergency truck yard -> tank. The scene may be a schematic spatial model, not surveyed CAD.
- Procedurally place each system/facility from `network.json` coordinates (or relative arrangements within grouped stages) and create reusable 3D modules for wells, tank, pumps, pipelines, trucks and disposal sites.
- Animations must communicate real state: animated water flow arrows/particles only with actual flow, fluid fill level from the selected observation or simulated future, pump visuals from state; truck movement tied to dispatch timing.
- Continuous historical replay is different from simulated what-if. Label both and support time controls.
- Clicking an alert focuses the right asset; clicking an asset opens a concise details panel. Camera automation should never obscure urgent alerts and must be interruptible.
- 3D must coexist with a persistent, clear alert rail: sponsor contact Michael stated rapid alert comprehension matters more than a flashy interactive map.
- Build a compelling **Start Demo** walkthrough driven by real practice scenarios and model outcomes. Start in a calm, fully navigable world, then show incidents, zoom, countdown, tempting manual plan, simulated Butterfly Effect, optimized plan and side-by-side cost/tank/truck comparisons.
- If 3D/WebGL is unavailable, the essential alerts, charts and decision planner must still work in a conventional accessible UI.

## Responsive layout
Desktop is priority for live judges: left alerts rail, center interactive 3D, right contextual details/plan comparisons; no hard requirement for this exact layout if a superior, demonstrably clearer arrangement emerges. Provide a useful fallback on smaller screens.

## Content standard
No random metric labels (e.g. "82 Hz", "efficiency 91.3%") copied from the third reference that the EOG dataset does not supply. No fabricated live streaming, cost, pressure, traffic or revenue.
