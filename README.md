# Rank Tide

[![make.fun](https://make.fun/badge/roblox-up-and-coming-forecast-01.svg)](https://make.fun/bounty/roblox-up-and-coming-forecast-01)
[![rank](https://make.fun/badge/roblox-up-and-coming-forecast-01/divyanshAgarwal123/roblox-up-and-coming-forecast-01/rank.svg)](https://make.fun/bounty/roblox-up-and-coming-forecast-01/leaderboard)
[![reward](https://make.fun/badge/roblox-up-and-coming-forecast-01/divyanshAgarwal123/roblox-up-and-coming-forecast-01/reward.svg)](https://make.fun/bounty/roblox-up-and-coming-forecast-01)

An offline probability forecast for Roblox's Up-and-Coming top 10 over a
72-hour window. Rank Tide combines historical rank transitions, recent momentum,
player-count growth and uncertainty about new games. It uses only the history
supplied to the program, with no network access, paid model calls or dependencies.

## Run

Node 22.18 or newer is required. There is no install step.

~~~sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
node --test test.mjs
~~~

The input directory contains history.ndjson and task.json. The program writes
forecast.json to the output directory. In the contest sandbox the defaults are
/input and /output. The horizon and cutoff are read from the task file.

## Forecast

The model finds historical pairs of chart observations separated by intervals
representative of the requested forecast window. For each future place, it
looks at the earlier rank, rank movement and player growth of the game that
eventually occupied it. These examples distribute probability among similar
games in the current chart. Game IDs are opaque; no particular game or date is
hardcoded.

Observation weights account for elapsed time, so hourly recordings do not
overwhelm a sparse archive merely through their sampling frequency. Three
predefined variants are averaged equally, combining wider rank uncertainty,
momentum-aware matching and greater emphasis on recent history. A smooth
persistence component regularizes sparse evidence. New games retain probability
through the output format's unnamed share.

Each place has at most 100 named games and probability mass at most 1. A game's
total probability across all ten places is also capped at 1. The top-10 list
selects games by expected membership and orders them by expected position.
The output is deterministic; no wall clock or random number generator is used.

## Development evidence

Three overlapping rolling-origin tests were made entirely within the kit's
34-snapshot input history. Each forecast saw only reads before its cutoff;
the following 72 hours supplied its test outcomes.

| Historical cutoff, UTC | Train reads | Test reads | House persistence | Rank Tide |
|---|---:|---:|---:|---:|
| 2026-11-02 07:36:30 | 14 | 10 | -42.864331 | -38.079717 |
| 2026-11-03 07:36:30 | 17 | 10 | -52.705470 | -38.399249 |
| 2026-11-04 07:36:30 | 20 | 11 | -50.686922 | -43.725133 |
| Mean | | | **-48.752241** | **-40.068033** |

Higher log score is better. These windows overlap and informed development;
they are not an independent holdout or an official competition result.
The official practice answer and scorer are not supplied in the kit, so the
server's grade is the authoritative practice result.

Tests check output constraints, deterministic forecasts, exclusion of future
reads, independence from numerical game IDs, unnamed probability scoring,
one-snapshot behavior and malformed-record filtering. The CLI is also run twice
on the kit input and its output bytes compared.

## Limitations

The history is small, the chart changes quickly, and the model cannot know the
identities of future releases. It assumes historical movement remains informative
and does not treat a game's API creation date as its publication date. Sparse
player counts and unknown chart mechanics limit momentum estimates. Backtest
improvement does not establish a winning final score or prize eligibility.

Source data belongs to its respective providers. The competition kit attributes
Roblox's chart recorder and Kenny-Dhub/roblox-snapshots; history data is not
redistributed in this repository. Code is MIT licensed.

---

Entered on [make.fun](https://make.fun/?ref=bkf8wnha&utm_source=github&utm_medium=readme&utm_campaign=roblox-up-and-coming-forecast-01).
