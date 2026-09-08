# OUR-FORK.md — The Fixed Edition

This is **Exaggarate/carapace** — our standalone edition of [carapace/carapace](https://github.com/Exaggarate/carapace) (MIT, © Carapace Foundation). Not affiliated with upstream; independent repo, **not a GitHub fork**. Upstream main is merged continuously; this repo layers issue-driven fixes on top.

## Mission

Take **every open upstream issue** (currently ~3,948) and fix it here. Fast paths:

- Issue already has a linked fix PR (`clawsweeper:linked-pr-open`) → cherry-pick/merge that branch when clean.
- Issue fixable in our tree → lands as `fix(area): <desc> (#<issue>) [our-fork]`.
- `needs-info` / `cannot-reproduce` / `needs-product-decision` / question-type → parked with reason.

## Operating loop

1. **Sync** — upstream `main` merged every 6h by automation (`carapace-fork-sync`). Upstream's resolution wins on conflicts; batch workers re-validate affected fixes after.
2. **Enumerate** — all open issues tracked in [our-fork/ISSUES.md](our-fork/ISSUES.md), refreshed by script (label-partitioned search queries to beat the 1000-result cap).
3. **Fix** — prioritized batches: P0/P1 `bug`/`bug:crash` with `clawsweeper:fix-shape-clear` first, then diamond-lobster rated, then the long tail.
4. **Verify** — tests + build per batch before push. One commit per issue.

## License

MIT, unchanged. `LICENSE` and `THIRD_PARTY_NOTICES.md` retained as-is. Credit to upstream authors and contributors; fixes curated by ERROR 404 & Clawd-X.