# Strategy

The target is mean log probability over ten places and all reads in a future
window. A single confident ordering is fragile: a changed place incurs the log
floor. The model therefore forecasts distributions and reserves probability for
games absent from the current candidate set.

Only strictly pre-cutoff snapshots enter estimation. All analogues and momentum
features are constructed from that prefix, with momentum at an analogue's origin
computed only from earlier reads. Future records present in an input are excluded.
Historical analogue outcomes are always earlier than the forecast cutoff.

The ensemble uses three fixed configurations rather than selecting the best
configuration on the small, overlapping development windows. It integrates
historical transition intervals across the whole requested horizon. Rank and
player-growth similarities are regularized by a persistence kernel, broad tails
and an unnamed-game share. Time-exposure weights correct the change from sparse
archive reads to hourly recordings.

The model reads no external file beyond the two task inputs and its own source.
It makes no network requests and has no hardcoded universe IDs. Its game-ID
equivariance test verifies that renaming all identities preserves probabilities.
Long histories are deterministically reduced to at most 160 observations spanning
the full supplied period, including the latest observation.

The server will run the same program again on the history up to the competition
deadline. The practice top ten is not submitted as a fixed forecast for the final
window. Final results, eligibility against the strongest house entry, and any
prize remain unknown until the actual future chart observations are scored.
