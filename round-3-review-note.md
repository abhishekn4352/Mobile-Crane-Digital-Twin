## What I asked the AI

I asked Copilot to add FULL and HALF outrigger states and make rated capacity, stability geometry, and pad reactions respect the selected state.

## What the AI got wrong or I rejected

The repository contained no verified HALF capacity column. I rejected inventing capacity values or reusing FULL capacity. HALF capacity returns unavailable. The 4.2 m transverse geometry is implemented, but the 8.9 m longitudinal dimension remains unverified.

## How I verified

Cycle 2 load-chart tests passed; Cycle 2 stability tests passed (19/19). Cycle 3 tests reported 96 passed and 1 failed. `git diff --check` passed. New tests cover missing HALF data, fallback prevention, geometry, pad reactions, and invalid states.

## What in the request I could not support, and what I did about it

I could not verify HALF capacity values or confirm the complete HALF configuration from the manufacturer chart. HALF capacity remains unavailable. The existing Cycle 3 test expecting 12.1 t conflicts with the chart's 12.4 t value at 70 m / 30 m. I left this unresolved pending source verification.