# Nexus Integration Landscape Diagram

**Owner:** Tim Motard (Nexus)  
**Purpose:** Visual map of all system integrations for Nexus offboarding  
**Last Updated:** January 30, 2026

---

## Overview

This diagram shows the integration status of all systems connected to (or planned for) Nexus offboarding workflows.

**Source:** INS-004 (Nexus Integration Landscape), Technical Audit Jan 29, 2026

---

## Integration Status Map

```mermaid
flowchart TD
    subgraph NEXUS["NEXUS PLATFORM"]
        CORE[Nexus Core<br/>Offboarding Module]
    end
    
    subgraph OPERATIONAL["OPERATIONAL"]
        TPMS[TPMS<br/>Tire Pressure<br/>GET only]
        HOLMAN[Holman<br/>Vehicle Details<br/>GET + POST]
        SNOWFLAKE[Snowflake HR Sync<br/>Daily 5am EST]
    end
    
    subgraph IN_PROGRESS["IN PROGRESS"]
        SEGNO[Segno<br/>Tool Listings<br/>API being stood up]
        AMS[AMS<br/>Vehicle Assignments<br/>DB access obtained]
        SAMSARA[Samsara<br/>GPS Data<br/>Coming soon]
    end
    
    subgraph DISABLED["DISABLED"]
        SENDGRID[SendGrid<br/>Email Automation<br/>Pending OneCard]
    end
    
    subgraph TESTING["TESTING"]
        PMF[PMF<br/>Vehicle Storage<br/>API in testing]
    end
    
    subgraph NOT_INTEGRATED["NOT INTEGRATED"]
        FLOWSPACE[Flow Space<br/>Lawrence Warehouse<br/>No integration]
    end
    
    subgraph COMING["COMING SOON"]
        RENTALS[Rentals<br/>Via Snowflake connector]
    end
    
    CORE --> TPMS
    CORE --> HOLMAN
    CORE --> SNOWFLAKE
    CORE -.->|In progress| SEGNO
    CORE -.->|In progress| AMS
    CORE -.->|Coming| SAMSARA
    CORE -.->|Disabled| SENDGRID
    CORE -.->|Testing| PMF
    CORE -.->|Gap| FLOWSPACE
    CORE -.->|Coming| RENTALS
    
    click FLOWSPACE "/project-memory/synthesis/PROJECT_INSIGHTS.md#ins-004" "INS-004: Integration Landscape"
    click RENTALS "/project-memory/synthesis/PROJECT_INSIGHTS.md#ins-004" "INS-004: Rentals via Snowflake"
    
    style TPMS fill:#dcfce7,stroke:#22c55e
    style HOLMAN fill:#dcfce7,stroke:#22c55e
    style SNOWFLAKE fill:#dcfce7,stroke:#22c55e
    style RENTALS fill:#fef3c7,stroke:#f59e0b
    style SEGNO fill:#fef3c7,stroke:#f59e0b
    style AMS fill:#fef3c7,stroke:#f59e0b
    style SAMSARA fill:#fef3c7,stroke:#f59e0b
    style SENDGRID fill:#fee2e2,stroke:#ef4444
    style PMF fill:#dbeafe,stroke:#3b82f6
    style FLOWSPACE fill:#fee2e2,stroke:#ef4444,stroke-width:3px
```

---

## Detailed Integration Status

```mermaid
flowchart LR
    subgraph DATA_IN["DATA SOURCES (INTO NEXUS)"]
        direction TB
        SF[Snowflake<br/>HR Terminations]
        TPMS_IN[TPMS<br/>Tire Data]
        HOLMAN_IN[Holman<br/>Vehicle Info]
        SAM_IN[Samsara<br/>GPS Location]
    end
    
    subgraph NEXUS["NEXUS CORE"]
        direction TB
        DB[(PostgreSQL<br/>queue_items<br/>all_techs)]
        SYNC[Snowflake Sync<br/>Service]
        API[REST API<br/>Endpoints]
    end
    
    subgraph DATA_OUT["DATA TARGETS (FROM NEXUS)"]
        direction TB
        SEGNO_OUT[Segno<br/>Order Cancellation]
        AMS_OUT[AMS<br/>Vehicle Status]
        PMF_OUT[PMF<br/>Routing]
        EMAIL_OUT[SendGrid<br/>Notifications]
    end
    
    SF --> SYNC
    SYNC --> DB
    TPMS_IN --> API
    HOLMAN_IN --> API
    SAM_IN -.->|Coming| API
    
    API --> SEGNO_OUT
    API -.->|No API| AMS_OUT
    API -.->|Testing| PMF_OUT
    API -.->|Disabled| EMAIL_OUT
    
    style SF fill:#dcfce7,stroke:#22c55e
    style TPMS_IN fill:#dcfce7,stroke:#22c55e
    style HOLMAN_IN fill:#dcfce7,stroke:#22c55e
    style SAM_IN fill:#fef3c7,stroke:#f59e0b
    style SEGNO_OUT fill:#fef3c7,stroke:#f59e0b
    style AMS_OUT fill:#fee2e2,stroke:#ef4444
    style PMF_OUT fill:#dbeafe,stroke:#3b82f6
    style EMAIL_OUT fill:#fee2e2,stroke:#ef4444
```

---

## System Detail Table

| System | Role | API Status | Data Type | Notes | Verification |
|--------|------|------------|-----------|-------|--------------|
| **TPMS** | Tire pressure monitoring | Operational | GET only | Results cached in `tpms_cached_assignments` | Code-Verified |
| **Holman** | Vehicle details | Operational | GET + POST | Auto-populates year/make/model/licensePlate | Code-Verified |
| **Snowflake HR Sync** | Termination data | Operational | Daily sync 5am EST | Uses `DRIVELINE_ALL_TECHS`, 30-day lookback | Code-Verified |
| **Segno** | Tool listings, onboarding data | In Progress | API being built | Luca working on this; critical for tool recovery | Per Tim |
| **AMS** | Vehicle assignments, repairs | In Progress | DB access only | No API; working on connectivity | Per Tim |
| **Samsara** | GPS, onboard diagnostics | Coming Soon | Streams every 15 min | Data flows to Snowflake | Per Tim |
| **PMF** | Controlled vehicle storage | Testing | API in testing | Default routing destination | Per Tim |
| **SendGrid** | Email automation | Disabled | Code exists | Pending OneCard team coordination | Code-Verified |
| **Rentals** | Rental vehicle data | Coming | Via Snowflake connector | Future integration | Per Tim |
| **Flow Space** | Lawrence warehouse receiving | Not Integrated | Manual queries only | Gap: No systematic check-in tracking | Claudia Demo |

---

## Data Flow for Offboarding

```mermaid
sequenceDiagram
    autonumber
    
    participant HR as HR System
    participant SF as Snowflake
    participant NX as Nexus
    participant TPMS as TPMS
    participant HOL as Holman
    participant SEG as Segno
    participant PMF as PMF
    
    Note over HR,SF: Daily at 5am EST
    HR->>SF: Push termination data
    SF->>NX: Sync DRIVELINE_ALL_TECHS
    NX->>NX: Filter by effectiveDate (30 days)
    NX->>NX: Check for existing tasks
    
    Note over NX: Manual form entry also possible
    
    NX->>TPMS: GET tire assignments
    TPMS-->>NX: Return cached data
    
    NX->>HOL: GET vehicle details
    HOL-->>NX: Return year/make/model
    
    NX->>SEG: Cancel orders (future)
    Note over NX,SEG: API being built
    
    NX->>PMF: Update routing (future)
    Note over NX,PMF: API in testing
```

---

## Key Dependencies for Tools Recovery

```mermaid
flowchart TD
    subgraph CURRENT["CURRENT STATE"]
        C1[Crystal Email<br/>Triggers notification]
        C2[Claudia<br/>Manual lookup in FleetScope]
        C3[Flow Space<br/>Manual queries at Lawrence]
    end
    
    subgraph FUTURE["FUTURE STATE (NEEDS)"]
        F1[Segno API<br/>Cancel orders automatically]
        F2[Fleet Routing<br/>Automatic notification to Tools]
        F3[Flow Space Integration<br/>Automated receipt tracking]
        F4[Tools Queue in Nexus<br/>Dedicated task for Claudia]
    end
    
    C1 -.->|Gap: No automation| F1
    C2 -.->|Gap: Manual process| F2
    C3 -.->|Gap: No integration| F3
    C1 -.->|Gap: No queue| F4
    
    style C1 fill:#dcfce7,stroke:#22c55e
    style C2 fill:#fef3c7,stroke:#f59e0b
    style C3 fill:#fee2e2,stroke:#ef4444
    style F1 fill:#dbeafe,stroke:#3b82f6
    style F2 fill:#dbeafe,stroke:#3b82f6
    style F3 fill:#dbeafe,stroke:#3b82f6
    style F4 fill:#dbeafe,stroke:#3b82f6
    
    click F4 "/project-memory/synthesis/PROJECT_INSIGHTS.md#ins-012" "INS-012: No Tools Queue"
    click C2 "/project-memory/synthesis/PROJECT_INSIGHTS.md#ins-017" "INS-017: Claudia blocked on Fleet"
    click C3 "/project-memory/synthesis/PROJECT_INSIGHTS.md#ins-021" "INS-021: Lawrence warehouse gap"
```

---

## Color Legend

| Color | Meaning |
|-------|---------|
| Green (#dcfce7) | Operational/Working |
| Blue (#dbeafe) | Testing |
| Yellow (#fef3c7) | In Progress / Coming Soon |
| Red (#fee2e2) | Disabled/Gap/Not Integrated |

---

## Related Documentation

| Document | Reference |
|----------|-----------|
| INS-004 | Nexus Integration Landscape |
| INS-005 | AMS vs Holman Data Source Distinction |
| INS-006 | Samsara GPS Capability |
| RISK-001 | Tim Capacity |

---

*Created: January 30, 2026*
