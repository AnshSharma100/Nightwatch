# Git and commits — development history standards

The user wants a rich, human-looking history of around 60 commits by the end of the hackathon. This is a **directional goal**, not a reason to fabricate contributions. Prefer genuine small increments with a working reason to exist.

## Rules
- Initialize Git at the beginning. Commit when an actual logical increment is complete and tested where practical.
- Natural, short messages in everyday language. No forced conventional-commits prefixes or robotic essays. Keep messages specific enough to understand the change.
- Good examples: `set up the app`, `load the network files`, `added tank level chart`, `fix pump state handling`, `added 3d camera controls`, `fixed the water visualization`, `show truck routes`, `track shared trucks`, `fix the cost comparison`, `add snapshot tests`, `polish the demo`, `make alerts easier to read`.
- Don't use vague messages like `Just pushing` repeatedly when they conceal what changed, and don't stage/commit no-op or fabricated edits to inflate the count.
- Never backdate, manufacture history, or claim code was human-written if AI assistance was used; comply with hackathon disclosure rules.
- After each meaningful vertical slice, run relevant tests, commit, and push to the authorized remote when available. Clearly say when pushing was unavailable.
- ~40–60 truthful, logically separated commits may naturally result from enough real increments; 25 substantive commits are better than 60 artificial ones.

## GitHub repository creation
- Start in a new empty local folder named `nightwatch-hackutd-2026`, place these handoff files at the root, `git init -b main`, and create the first initial commit.
- Use the authenticated GitHub CLI if available: check `gh auth status`, then `gh repo create nightwatch-hackutd-2026 --private --source=. --remote=origin --push`. The remote is PRIVATE initially to avoid accidentally publishing reference materials.
- If not authenticated or permissions disallow creation, do not fake success; leave a working local repository and tell the user precisely which GitHub sign-in or step is needed.
- Do not publish user interview transcripts or third-party visual reference images; `reference_private/` and `visual_references/` are gitignored.
- If a public repo is required for submission, explicitly verify official submission rules and obtain the user's approval before changing repository visibility.
- Don't force-push or rewrite teammates' commits.
