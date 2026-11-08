# Third-party software and data

The EOG Resources challenge repository provides the simulation rules and practice recordings. The deployment build pins the reference to `135ba4c8348357457420a1111df80ec1906bcbdb`. The application uses its network, operations, and telemetry files. Upstream answer keys stay in the offline validation checkout. [Official EOG challenge](https://github.com/nihaal419/HackUTD-ZeroDay)

The table lists direct runtime packages and primary development tools from the lockfile. The installed packages retain their upstream license notices.

| Package | Locked version | License |
| --- | --- | --- |
| React and React DOM | 19.3.1 | MIT |
| Three.js | 0.183.2 | MIT |
| React Three Fiber | 9.8.2 | MIT |
| Drei | 10.7.9 | MIT |
| Lucide React | 0.577.0 | ISC |
| node-postgres | 8.23.1 | MIT |
| Web Push | 4.0.0 | MPL-2.0 |
| Vite | 8.3.6 | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| Playwright Test | 1.65.0 | Apache-2.0 |

The deployment uses Node.js, PostgreSQL, and the unprivileged NGINX image. NVIDIA Nemotron inference uses the hosted NVIDIA Build API. [NVIDIA model](https://build.nvidia.com/nvidia/nemotron-3.5-super-vl-120b-a12b) · [NGINX unprivileged image](https://github.com/nginx/docker-nginx-unprivileged) · [PostgreSQL license](https://www.postgresql.org/about/licence/)
