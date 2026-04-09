# Nexus Endpoint Spec — Two Builds Required for Agent Phase 2

**Owner:** Nexus / Fleet Services app (shs-nexus.replit.app)  
**Consumer:** Rental Recovery Agent backend (`FleetAPIAdapter`, `SpareSearchService`)  
**Auth:** All endpoints use existing `X-Api-Key: PublicSparesAPI` header

---

## Build 1 — Enrich `GET /rentals` (and `GET /rentals/:truckNumber`) with AMS type data

### What changes
The existing `/rentals` and `/rentals/:truckNumber` endpoints already work. This adds two new fields to each record when the vehicle is found in AMS.

### New fields to append
```json
{
  "techType": "General Home Appliance",
  "vehicleType": "No racks"
}
```

### Logic (per rental record)

```
function enrichWithAMS(rentalRecord):
  if rentalRecord.inAms == false:
    return rentalRecord  // skip — no AMS record exists

  amsVehicle = AMS.lookup(truckNumber: rentalRecord.truckNumber)
                   OR AMS.lookup(vin: rentalRecord.vin)

  if amsVehicle not found:
    return rentalRecord  // skip gracefully

  rentalRecord.techType    = mapTechType(amsVehicle.techType)
  rentalRecord.vehicleType = mapVehicleType(amsVehicle.vehicleType)
  return rentalRecord
```

### AMS → Agent taxonomy mappings

**techType mapping:**
| AMS value | Agent value |
|-----------|-------------|
| `"General"` | `"General Home Appliance"` |
| `"General Home Appliance"` | `"General Home Appliance"` |
| `"Ref+General"` | `"Ref + General Home Appliance"` |
| `"Ref + General"` | `"Ref + General Home Appliance"` |
| `"HVAC"` | `"HVAC"` |
| *(absent/unknown)* | omit field |

**vehicleType mapping:**
| AMS value | Agent value |
|-----------|-------------|
| `"No racks"` | `"No racks"` |
| `"Ref with racks"` | `"Ref (with racks)"` |
| `"Ref (with racks)"` | `"Ref (with racks)"` |
| `"HVAC van"` | `"HVAC van"` |
| `"HVAC Van"` | `"HVAC van"` |
| *(absent/unknown)* | omit field |

### Performance note
AMS lookups should be batched or cached (e.g. warm a map of `truckNumber → {techType, vehicleType}` once per request cycle) rather than one HTTP call per rental record. For `/rentals` returning 300+ records this matters.

### When `inAms: false`
Simply omit `techType` and `vehicleType` from the response. The agent backend defaults to `"General Home Appliance"` / `"No racks"` and logs a warning. This is safe — it just means type-compatibility filtering will use conservative defaults for that vehicle.

---

## Build 2 — New endpoint `GET /spares/search`

### Signature
```
GET /api/fs/public/spares/search
X-Api-Key: PublicSparesAPI
```

### Query parameters
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `techType` | string | Yes | Agent taxonomy: `"General Home Appliance"`, `"Ref + General Home Appliance"`, `"HVAC"` |
| `lat` | float | No | Tech's current latitude (from Samsara) for proximity scoring |
| `lon` | float | No | Tech's current longitude (from Samsara) for proximity scoring |
| `limit` | int | No | Max results to return (default: 10) |

### Type compatibility gate (enforce in Nexus — hard rule, never bypass)
| techType | Compatible vehicleTypes |
|----------|------------------------|
| `General Home Appliance` | `No racks`, `Ref (with racks)` |
| `Ref + General Home Appliance` | `Ref (with racks)`, `No racks` |
| `HVAC` | `HVAC van`, `Ref (with racks)` |

Filter candidates to compatible types **before** any scoring.

### Logic

```
function GET /spares/search(techType, lat, lon, limit):

  // Step 1 — Query AMS for spare vehicles
  amsSpares = AMS.getVehicles(
    status    = "Spare",
    condition = "Operational"
  )

  // Step 2 — Filter: registration must not be expired
  today = currentDate()
  eligible = amsSpares.filter(v =>
    v.registrationExpiryDate == null   // unknown = don't block
    OR v.registrationExpiryDate > today
  )

  // Step 3 — Apply type compatibility gate
  compatibleTypes = getCompatibleVehicleTypes(techType)  // see table above
  eligible = eligible.filter(v => compatibleTypes.includes(v.vehicleType))

  // Step 4 — Enrich with location from Samsara (optional, best-effort)
  for each vehicle in eligible:
    samsaraData = Samsara.getVehicleLocation(vehicle.vin OR vehicle.truckNumber)
    vehicle.currentLat = samsaraData.lat
    vehicle.currentLon = samsaraData.lon
    vehicle.currentLocation = samsaraData.locationName

  // Step 5 — Score by proximity if lat/lon provided
  if lat and lon provided:
    for each vehicle in eligible:
      vehicle.distanceMiles = haversine(lat, lon, vehicle.currentLat, vehicle.currentLon)
    eligible.sortBy(distanceMiles ASC)
  
  // Step 6 — Enrich with PMF lot info (optional, best-effort)
  for each vehicle in eligible[:limit]:
    pmfData = PMF.getLotInfo(vehicle.truckNumber)
    vehicle.lotName    = pmfData.lotName
    vehicle.lotAddress = pmfData.lotAddress
    vehicle.lotPhone   = pmfData.lotPhone

  return eligible[:limit]
```

### Response shape
```json
{
  "data": [
    {
      "vehicle_number": "45123",
      "vin": "1FTBF2B60GEB00001",
      "vehicle_type": "No racks",
      "tech_type": "General Home Appliance",
      "current_location": "San Bernardino, CA",
      "current_lat": 34.1083,
      "current_lon": -117.2898,
      "distance_miles": 12.4,
      "registration_expiry": "2026-08-15",
      "condition": "Operational",
      "lot_name": "PMF San Bernardino",
      "lot_address": "123 Industrial Blvd, San Bernardino, CA",
      "lot_phone": "(909) 555-0100"
    }
  ],
  "total": 3,
  "tech_type": "General Home Appliance",
  "compatible_vehicle_types": ["No racks", "Ref (with racks)"]
}
```

### Error cases
| Condition | Response |
|-----------|----------|
| `techType` missing | `400 Bad Request` — `"techType is required"` |
| `techType` unrecognized | `400 Bad Request` — `"Unknown techType"` |
| AMS unreachable | `503 Service Unavailable` — agent `SpareSearchService` falls back to local store |
| No eligible spares found | `200 OK` with `"data": []` — agent escalates to Oscar |

### Samsara / PMF failures
Both are best-effort enrichments. If Samsara or PMF times out, return the candidate without location/lot data rather than failing the whole request. The agent can still present the vehicle — Oscar will handle the logistics.

---

## Summary

| Build | Effort | Impact |
|-------|--------|--------|
| Enrich `/rentals` with AMS type data | Low — join on existing AMS lookup, append 2 fields | Unlocks type-compatibility filtering for all 311 live vehicles |
| `GET /spares/search` | Medium — composite query across AMS + Samsara + PMF | Enables the agent to find and call spare vehicles autonomously |
