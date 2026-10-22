## What I asked the AI

First prompt ("add selector, scale chart by 0.5") was too loose. I re-prompted with constraints: reuse chartFor/machineMassT; label 40 t "ASSUMED, not manufacturer data" in source and UI; keep pad-sum validation at the recording's 170 t; cwtT only for capacity/stability/modeled pads; chartFor throws on invalid tonnage; tests (0.5 ratio, nulls, invalid config, DATA_QUALITY parity); Cycle-3 only.

## What the AI got wrong or I rejected

The AI said: "Pad-sum validation now uses `machineMassT(cwtT)` so 40 t config doesn't spuriously fail." It did the opposite: on 40 t, 31,859 of 31,860 deployed rows became DATA_QUALITY and OVERLOAD fell 323 -> 0. I rejected it; validation stays at 170 t. It also left the manufacturer source on the scaled chart.

## How I verified

`node js/test_counterweightConfig.mjs`: 14 passed, 0 failed. Recording (39,301 rows): DATA_QUALITY 4 vs 4; OVERLOAD 323 (80 t) vs 1595 (40 t). craneModel and sensorPanelUI each have 1 failure, identical on the base commit (12.1 vs 12.4 t).

## What in the request I could not support, and what I did about it

"Capacity halves" has no manufacturer basis; no 40 t chart exists. I implemented it but labelled it ASSUMED. Recorded LMI comes from an 80 t machine, so LMI_DIVERGENCE rises 43 -> 6,562 on 40 t; I left it visible.
