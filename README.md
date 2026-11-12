# Rank Tide

[![make.fun](https://make.fun/badge/roblox-up-and-coming-forecast-01.svg)](https://make.fun/bounty/roblox-up-and-coming-forecast-01)
[![rank](https://make.fun/badge/roblox-up-and-coming-forecast-01/divyanshAgarwal123/roblox-up-and-coming-forecast-01/rank.svg)](https://make.fun/bounty/roblox-up-and-coming-forecast-01/leaderboard)
[![reward](https://make.fun/badge/roblox-up-and-coming-forecast-01/divyanshAgarwal123/roblox-up-and-coming-forecast-01/reward.svg)](https://make.fun/bounty/roblox-up-and-coming-forecast-01)

An offline probability forecast for Roblox's Up-and-Coming top 10 over a
72-hour window. Rank Tide simulates joint rankings from damped rank momentum,
uncertainty and historical newcomer arrivals. It uses only the history
supplied to the program, with no network access, paid model calls or dependencies.

## Run

Node 22.18 or newer is required. There is no install step.

~~~sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
node --test test.mjs
node validate.mjs /path/to/input
~~~

The input directory contains history.ndjson and task.json. The program writes
forecast.json to the output directory. In the contest sandbox the defaults are
/input and /output. The horizon and cutoff are read from the task file.

## Forecast

Version 2 estimates each game's log-rank velocity from its recent observations.
That velocity is damped as the horizon increases. Seeded simulations perturb
the projected ranks with uncertainty that grows with elapsed time, including
a heavier-tail component for sudden breakouts and drops. Sorting each simulated
chart gives a joint distribution: one game can occupy only one place per draw.

Historical chart pairs supply newcomer arrival patterns at comparable horizons.
Their time-exposure weights reduce bias from changes in recorder frequency.
New arrivals take places before the known games fill the remaining places;
their probability is kept in the output format's unnamed share. A small
diffuse component prevents zero probabilities from finite simulation counts.

Four components are averaged equally: an 18-hour trend with two uncertainty
levels, a 36-hour trend and a 60-hour trend. Each makes 24,000 simulations,
covering the whole requested window. Game IDs are opaque; no particular game,
date, practice answer or future observation is hardcoded.

Each place has at most 100 named games and probability mass at most 1. A game's
total probability across all ten places is also capped at 1. The top-10 list
selects games by expected membership and orders them by expected position.
The output is deterministic; all simulation randomness has a fixed seed,
independent of game IDs and the wall clock.

## Development evidence

Four overlapping rolling-origin tests were made entirely within the kit's
34-snapshot input history. Each forecast saw only reads before its cutoff;
the following 72 hours supplied its test outcomes.

| Historical cutoff, UTC | Train reads | Test reads | House persistence | Version 1 | Version 2 |
|---|---:|---:|---:|---:|---:|
| 2026-11-01 07:36:30 | 10 | 10 | -47.900927 | -38.109925 | -36.751515 |
| 2026-11-02 07:36:30 | 14 | 10 | -42.864331 | -38.079717 | -34.789831 |
| 2026-11-03 07:36:30 | 17 | 10 | -52.705470 | -38.399249 | -36.934531 |
| 2026-11-04 07:36:30 | 20 | 11 | -50.686922 | -43.725133 | -42.579014 |
| Mean | | | **-48.539412** | **-39.578506** | **-37.763723** |

Higher log score is better. These windows overlap and informed development;
they are not an independent holdout or an official competition result.
The official practice answer and scorer are not supplied in the kit, so the
server's grade is the authoritative practice result. Version 1 scored
-37.282779 officially; version 2's local table is a different set of windows,
and is not comparable to that official score.

Tests check output constraints, deterministic forecasts, exclusion of future
reads, independence from numerical game IDs, unnamed probability scoring,
one-snapshot behavior, malformed-record filtering, valid horizons and the
direction of momentum's effect. The CLI is also run twice
on the kit input and its output bytes compared.

## Limitations

The history is small, the chart changes quickly, and the model cannot know the
identities of future releases. It assumes historical movement remains informative
and does not treat a game's API creation date as its publication date. Unknown
chart mechanics and sudden promotion changes limit momentum estimates. Backtest
improvement does not establish a winning final score or prize eligibility.

Source data belongs to its respective providers. The competition kit attributes
Roblox's chart recorder and Kenny-Dhub/roblox-snapshots; history data is not
redistributed in this repository. Code is MIT licensed.

---

Entered on [make.fun](https://make.fun/?ref=bkf8wnha&utm_source=github&utm_medium=readme&utm_campaign=roblox-up-and-coming-forecast-01).
