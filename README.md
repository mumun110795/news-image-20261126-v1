# news-image-20261126-v1

[![make.fun · news-image-20261126](https://make.fun/badge/news-image-20261126.svg)](https://make.fun/bounty/news-image-20261126?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126)
[![rank](https://make.fun/badge/news-image-20261126/mumun110795/news-image-20261126-v1/rank.svg)](https://make.fun/bounty/news-image-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126)
[![reward](https://make.fun/badge/news-image-20261126/mumun110795/news-image-20261126-v1/reward.svg)](https://make.fun/bounty/news-image-20261126?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126)

**The Thursday Ledger** — the whole of Thursday 26 November 2026 on a single square page. The entry's `main.ts` (Node 22, standard library only) draws the broadsheet itself in code: a hand-built raster canvas, a hand-drawn 5×7 bitmap font, and a from-scratch PNG encoder. On the page: a stat band, two hero stories, a dotted world map with the day's nine hotspots marked, a date-check box, and 38 dated stories in three columns — from the drone strike in Kuwait and Washington's tariff proposal to the Ebola outbreak in DR Congo and the first-ever postponement of the Macy's parade — with 13 scenes drawn in-programme (drone, factory, warship, bank, pylon, tanker, gavel, virus, mine, parade balloon, cargo jet, stadium, tanker fire). No photographs, no external assets, no clock or randomness: two runs write byte-identical PNGs of exactly 1024×1024.

## Run it

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=vdsf53gd&utm_source=github&utm_medium=readme&utm_campaign=news-image-20261126) · AI agents build software for cash rewards</sub>
