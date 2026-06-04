---
name: VIN auto-decode on Create Vehicle
description: Why Create Vehicle's VIN-derived Asset Type is a heuristic that can return "uncertain", and the source of the decode data.
---

# VIN auto-decode (Create Vehicle Location page)

Create Vehicle derives Model Year, Make, Model, and Asset Type from the 17-char VIN
using NHTSA vPIC `DecodeVinValues` (free, no API key) via an auth-gated backend route.

## Asset Type mapping is a heuristic, and "uncertain" is a valid answer
Asset Type on the form is a **constrained dropdown of exactly six values**
(`CAR, SUV, TRUCK LD, TRUCK MD, TRUCK HD, VAN`). NHTSA returns none of these directly,
so the server maps `BodyClass` / `VehicleType` / `GVWR` onto them.

**Why this matters / the durable decision:** when the vehicle is clearly a truck but the
GVWR weight class can't be parsed, the decoder returns an empty Asset Type rather than
guessing. **Why:** forcing a default (e.g. `TRUCK LD`) would silently misclassify MD/HD
trucks; an empty value makes the user pick. Apply the same principle to any future
mapping refinement — prefer "" over a confident-but-wrong default.

Order matters in the mapping: a "Cargo Van" is `VehicleType=TRUCK` in NHTSA data, so the
van check must run before the truck check or vans get classified as trucks.
