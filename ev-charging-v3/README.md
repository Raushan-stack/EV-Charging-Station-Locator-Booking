# VoltSlot - EV Charging Station Locator & Booking (merged project)

DBMS project, SDG 7. Team: Aarya (FR-01 to FR-07) and Raushan (FR-08 to FR-15).

This is **one integrated project**: Raushan's tested database + backend, plus Aarya's login, search,
geolocation, availability grid, booking screens and double-booking demo, all served from one URL.

```
database/   Raushan - schema, stored procedures, views, sample data, SQL tests
backend/    Raushan's API  +  Aarya's routes/auth.js and routes/stations.js
frontend/   Aarya's web app (served by the backend at http://localhost:3000)
docs/       Raushan's docs + evidence  |  docs/COMPLETENESS_AUDIT.md (what is done / still open)
```

## Run it

Needs MySQL 8.0.16+ (or MariaDB 10.5+) and Node.js 18+.

```bash
# 1. database - EASIEST: open database/00_install_all_in_one.sql in MySQL Workbench and press the lightning button.
#    (or in a terminal:  mysql -u root -p < database/00_install_all_in_one.sql )
#    It drops and recreates the database ev_charging, then runs 01 schema, 02 procedures, 03 views, 04 sample data.
#    Alternative on Mac/Linux/Git Bash:  bash scripts/install_db.sh ev_charging -u root -p

# 2. backend
cd backend
cp .env.example .env          # Windows: copy .env.example .env   -> then set DB_PASSWORD and JWT_SECRET
npm install
npm run seed:harry            # creates the login HARRY / harry@123
npm start
```
Open **http://localhost:3000**

## Logins

| Who | Login id | Password |
|-----|----------|----------|
| **Harry** (normal user) | `HARRY` (or harry@example.com) | `harry@123` |
| Admin | admin@evcharge.test | Password@123 |
| Sample users | usera@evcharge.test, userb@evcharge.test, userc@evcharge.test | Password@123 |

The login id can be the email or the user's name (so `HARRY` works). Names are unique for this reason.
If you re-install the database, run `npm run seed:harry` again (the rebuild wipes the users table).

## Demo tips

* **Double-booking demo:** menu "Double-booking demo" -> pick a slot -> Run the race. The second driver
  defaults to userb@evcharge.test. One gets Booked, the other gets `SLOT_UNAVAILABLE`.
* **Sample slots cover today + the next 3 days, 24 hours**, so a charging-session demo needs no database tweaks:
  book the slot of the *current hour*, open *My bookings*, press Start charging, then End charging (enter kWh).
  Cancelling needs the slot to start more than 60 minutes away.
* **Before every demo / after any database reinstall:** `scripts/reset_demo_db.sh root <mysql-password>`
  (rebuilds the database and re-creates HARRY, because a rebuild wipes the users table).
* **Real-browser test + screenshots:** with `npm start` running and a fresh database, `npm run test:ui`
  (needs `pip install playwright`); screenshots go to `docs/screenshots/`.
* **Aarya's tests (FR-01 to FR-07):** `npm test` also runs 13 automated login/search/slot-grid tests. In addition keep `npm start` running, open a second terminal in `backend` and run
  `npm run test:aarya` (about 30 checks: login, search, distance, slot grid, booking, double booking, cancel).
* Raushan's tests: `scripts/run_all_tests.sh root <mysql-password>` (also needs `npm install` in backend).

## FR -> files

| FR | Owner | Where |
|----|-------|-------|
| 01 login/register/profile | Aarya | `backend/src/routes/auth.js`, `frontend/app.js` (pageLogin) |
| 02 station info | Aarya | `routes/stations.js` (view), admin tab uses Raushan's admin API |
| 03 search + filters | Aarya | `routes/stations.js` GET `/`, `pageStations` |
| 04 geolocation | Aarya | browser Geolocation + Haversine SQL in `routes/stations.js` |
| 05 availability | Aarya | `routes/stations.js` GET `/:id/slots`, slot grid in `pageStation` |
| 06 booking | Aarya (UI) | `pageStation` -> `POST /api/bookings` (Raushan's `sp_book_slot`) |
| 07 concurrency demo | Aarya (UI) | `pageDemo` |
| 08-15 | Raushan | `database/`, `backend/src/services`, `backend/tests`, `docs/` |

See `docs/PROJECT_CHECKLIST.md` (every item of your checklist PDF with its status) and `docs/COMPLETENESS_AUDIT.md` (what was checked, bugs fixed, limitations).
