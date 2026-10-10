# API Reference (Raushan's backend)

Base URL `http://localhost:3000`. JSON in/out. Times are **database server local time**, format `YYYY-MM-DD HH:MM:SS` (strings — no timezone conversion).

Success: `{ "success": true, "data": ..., "meta": {...}? }`
Error: `{ "success": false, "error": { "code": "SLOT_UNAVAILABLE", "message": "..." } }`

## Integration contract (for Aarya)
1. **Auth:** every endpoint except `/api/health` and `/api/availability/*` needs `Authorization: Bearer <JWT>`.
   The JWT must be HS256, signed with the shared `JWT_SECRET`, payload `{ "user_id": <users.user_id>, "exp": ... }`.
   Role is **not** read from the token — it is looked up in `users.role` on each request.
   Example login code for Aarya (Node): `jwt.sign({ user_id: row.user_id }, process.env.JWT_SECRET, { expiresIn: '2h' })`.
2. **Users table:** FR-01 uses `users(user_id, name, email, phone, password_hash, role, is_active)`. Store bcrypt hashes (sample users use bcrypt).
3. **Show these error codes to the user:** `SLOT_UNAVAILABLE` (the concurrent-booking loser), `BOOKING_OVERLAP`, `CANCEL_TOO_LATE`, `SESSION_TOO_EARLY`, `VALIDATION_ERROR`.
4. After any booking / cancel / session call, **re-fetch** `/api/availability/slots` (FR-05 refresh).
5. CORS is enabled (`CORS_ORIGIN`). For quick tests without a login, start the server with `ALLOW_DEV_AUTH=true` and send `X-User-Id: 2`.


## Added by Aarya's part (FR-01 to FR-05)
| Method & path | Login? | Description |
|---|---|---|
| `POST /api/auth/register` `{name,email,phone,password}` | no | 201 `{token,user}`; name must be unique and contain no `@` (it is also a login id); password 8+ chars with a letter and a number; 409 duplicate |
| `POST /api/auth/login` `{login,password}` | no | `login` = email **or** name (case-insensitive). Same 401 `INVALID_CREDENTIALS` message for unknown user and wrong password. Token = HS256 JWT `{user_id}`, 8 h |
| `GET /api/auth/me` · `PUT /api/auth/me` `{name,phone}` | yes | profile |
| `GET /api/stations?q=&type=&only_available=true&lat=&lng=&radius_km=` | no | search/filter; with `lat`+`lng` returns `distance_km` (Haversine) sorted nearest first. Stations that are not ACTIVE are not listed |
| `GET /api/stations/:id` | no | station + its chargers |
| `GET /api/stations/:id/slots?date=YYYY-MM-DD` | optional | every slot of the day for the grid (`AVAILABLE`/`BOOKED`/`BLOCKED`, `is_past`, `my_booking_id` when a token is sent) + `server_time` |

The web app (`frontend/`) is served by the same server at `/`.

## Public (no login)
| Method & path | Description |
|---|---|
| `GET /api/health` | liveness + DB check |
| `GET /api/availability/stations` | per-station charger/slot counts (`Station_Availability_View`) |
| `GET /api/availability/slots?station_id=&charger_id=&charger_type=&date=YYYY-MM-DD&limit=&offset=` | bookable slots (`Available_Slots_View`); `charger_type` ∈ CCS2, CHAdeMO, Type2, GBT, AC001 |

## User (login required)
| Method & path | Body | Result |
|---|---|---|
| `POST /api/bookings` | `{ "slot_id": 12 }` | **201** `{booking_id, slot_id, status:"CONFIRMED"}` · **409** `SLOT_UNAVAILABLE` / `SLOT_EXPIRED` / `BOOKING_OVERLAP` / `CHARGER_UNAVAILABLE` · 404 `SLOT_NOT_FOUND` · 400 `VALIDATION_ERROR` |
| `GET /api/bookings/:id` | – | own booking (admin: any) |
| `POST /api/bookings/:id/cancel` | – | 200 · 409 `INVALID_BOOKING_STATE` / `CANCEL_TOO_LATE` · 403 `NOT_OWNER` · 404 |
| `POST /api/sessions/start` | `{ "booking_id": 5 }` | 201 `{session_id}` · 409 `SESSION_TOO_EARLY` / `SLOT_EXPIRED` / `SESSION_ALREADY_STARTED` / `INVALID_BOOKING_STATE` |
| `POST /api/sessions/:id/end` | `{ "energy_kwh": 12.5 }` | 200 `{energy_kwh, cost, duration_minutes}` · 400 `INVALID_ENERGY` · 409 `SESSION_NOT_ACTIVE` |
| `GET /api/sessions/:id` | – | session summary |
| `GET /api/history/bookings?status=&active=true&limit=&offset=` | – | `data[]` + `meta.total` (status ∈ CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED) |
| `GET /api/history/sessions?limit=&offset=` | – | `data[]` + `meta.summary {completed_sessions,total_energy_kwh,total_cost}` |

Business rules: owner may cancel only `CONFIRMED` bookings ≥ 60 min before the slot; a session may start from 15 min before the slot until it ends; cost = energy × charger `price_per_kwh`; energy cannot exceed `power_kw × slot hours`. (Rules 60/15 live in table `app_setting`.)

## Admin (role ADMIN)
| Method & path | Notes |
|---|---|
| `GET /api/admin/dashboard` | totals, upcoming slots by status, bookings by status, sessions/energy/revenue, per-station utilization |
| `GET/POST /api/admin/stations`, `GET/PUT/DELETE /api/admin/stations/:id` | `{name,address,latitude,longitude,status}`; delete blocked (409 `IN_USE`) while chargers exist |
| `GET /api/admin/chargers?station_id=` · `POST /api/admin/stations/:id/chargers` · `PUT/DELETE /api/admin/chargers/:id` | `{charger_type,power_kw,price_per_kwh,status}` |
| `GET /api/admin/chargers/:id/slots?date=` · `POST /api/admin/chargers/:id/slots` | single slot `{start_time,end_time}`; overlap → 409 `SLOT_OVERLAP` |
| `POST /api/admin/chargers/:id/slots/generate` | `{date,start_hour,end_hour,slot_minutes}` → `{slots_created}`; safe to re-run |
| `PATCH /api/admin/slots/:id/status` | `{status:"BLOCKED"|"AVAILABLE"}`; a BOOKED slot cannot be changed (cancel first) |
| `DELETE /api/admin/slots/:id` | only slots that never had a booking |
| `GET /api/admin/bookings?status=&station_id=&date=` · `GET /api/admin/bookings/:id/audit` · `POST /api/admin/bookings/:id/cancel` | monitor / audit trail / force-cancel (ignores owner + cut-off) |
| `GET /api/admin/sessions?status=&station_id=` · `POST /api/admin/sessions/:id/end` | monitor / end a stuck session |

## Error codes
`VALIDATION_ERROR` 400 · `INVALID_JSON` 400 · `INVALID_ENERGY` 400 · `INVALID_INPUT` 400 · `INVALID_REFERENCE` 400 · `CONSTRAINT_VIOLATION` 400 · `UNAUTHENTICATED`/`INVALID_TOKEN` 401 · `FORBIDDEN`/`NOT_OWNER` 403 · `*_NOT_FOUND`/`NOT_FOUND` 404 · `SLOT_UNAVAILABLE`, `SLOT_EXPIRED`, `BOOKING_OVERLAP`, `CHARGER_UNAVAILABLE`, `INVALID_BOOKING_STATE`, `CANCEL_TOO_LATE`, `SESSION_TOO_EARLY`, `SESSION_ALREADY_STARTED`, `SESSION_NOT_ACTIVE`, `SLOT_OVERLAP`, `INVALID_SLOT_STATE`, `IN_USE`, `DUPLICATE_ENTRY` 409 · `DB_BUSY` 503 · `INTERNAL_ERROR`/`SIMULATED_FAILURE` 500.
