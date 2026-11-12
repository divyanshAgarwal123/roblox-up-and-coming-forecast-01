# Strategy

The target is mean log probability over ten places and all reads in a future
window. A confident fixed ordering is fragile, so Rank Tide estimates full
place distributions and reserves probability for future releases.

Only strictly pre-cutoff snapshots enter estimation. Recent log-rank velocities
are estimated by exponentially weighted regression, with shrinkage for very
short observation spans. Extrapolation is damped after 36 hours. Independent
simulations of latent rank include increasing uncertainty and a broad-tail
mixture, then sort all current games to produce coherent rankings.

Newcomer arrival patterns come from historical origin/outcome pairs, both
strictly before the cutoff. Patterns are matched to forecast horizon and
weighted by recency and time exposure. Their unseen games occupy positions in
the simulated future chart; current games fill the remaining positions.

Four equally weighted components span 18, 36 and 60-hour trend memories and two
noise scales. Each runs 24,000 seeded simulations over the full forecast window.
A diffuse floor smooths simulation error. Output probabilities are capped to
respect both each place's budget and each game's total membership probability.

The model reads only the task inputs and its own source, makes no network or
model calls, and has no hardcoded universe IDs. Game-ID equivariance, fixed
seeds and exclusion of future input rows are tested. Long histories are reduced
deterministically to at most 160 observations spanning the supplied period.

The old analogue model remains in forecast.ts for the reproducible comparisons
in validate.mjs; main.ts executes the new simulation ensemble in dynamics.ts.
The four overlapping development windows informed model choices and are not
independent validation. The server reruns the program on the final pre-deadline
history. Final results, house-baseline eligibility and any prize remain unknown
until the actual future chart is scored.
