"""Browser test of the whole user + admin flow (real Chromium) and screenshot capture.
Run with the server already started on http://localhost:3000 and a freshly installed database:
    python3 backend/tests/ui_flow.py
Screenshots are written to docs/screenshots/. Needs:  pip install playwright  (Chromium already installed)"""
import json, os, sys, urllib.request
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('BASE', 'http://localhost:3000')
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'docs', 'screenshots')
os.makedirs(OUT, exist_ok=True)
results = []

def check(name, ok, extra=''):
    results.append((name, bool(ok)))
    print(('  PASS  ' if ok else '  FAIL  ') + name + ('' if ok else '  ' + str(extra)))

def api(path, method='GET', body=None, token=None):
    req = urllib.request.Request(BASE + '/api' + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return json.load(r)
    except urllib.error.HTTPError as e: return json.load(e)

def shot(page, name): page.screenshot(path=os.path.join(OUT, name + '.png'), full_page=True)

def toast_text(page): return page.locator('#toast .toast').last.inner_text()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, geolocation={'latitude': 28.6139, 'longitude': 77.2090}, permissions=['geolocation'])
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    # 4xx answers (wrong password, duplicate, conflict) are expected in this test and are logged by Chromium as 'Failed to load resource'
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)

    print('FR-01 login / register')
    page.goto(BASE); page.wait_for_selector('#f')
    shot(page, '01_login')
    page.fill('#login', 'HARRY'); page.fill('#password', 'wrong-password'); page.click('button[type=submit]')
    page.wait_for_selector('#toast .toast'); check('T04 wrong password shows a clear error', 'Invalid login' in toast_text(page), toast_text(page))
    page.click('[data-m=register]')
    page.fill('#name', 'Riya Test'); page.fill('#email', 'riya@example.com'); page.fill('#phone', '9811122233'); page.fill('#password', 'abc12345')
    page.click('button[type=submit]'); page.wait_for_selector('#nav #logout')
    check('T01 registration logs the new user in', 'Riya Test' in page.inner_text('#nav'))
    page.click('#logout'); page.wait_for_selector('#f')
    page.click('[data-m=register]'); page.fill('#name', 'Riya Two'); page.fill('#email', 'riya@example.com'); page.fill('#phone', '9811122233'); page.fill('#password', 'abc12345')
    page.click('button[type=submit]')
    try:
        page.wait_for_selector('#toast .toast:has-text("already")', timeout=5000); dup_ok = True
    except Exception:
        dup_ok = False
    check('T02 duplicate email rejected with a clear message', dup_ok, toast_text(page))
    page.click('[data-m=login]'); page.fill('#login', 'HARRY'); page.fill('#password', 'harry@123'); page.click('button[type=submit]')
    page.wait_for_selector('#list .station')
    check('T03 login as HARRY opens the station list', 'HARRY'.lower() in page.inner_text('#nav').lower())
    shot(page, '02_station_list')

    print('FR-03 / FR-04 search + geolocation')
    page.fill('#q', 'Saket'); page.click('#sf button[type=submit]'); page.wait_for_timeout(500)
    check('T05 search "Saket" shows only South Delhi', page.locator('#list .station').count() == 1 and 'South Delhi' in page.inner_text('#list'))
    shot(page, '03_search')
    page.fill('#q', ''); page.select_option('#type', 'CHAdeMO'); page.click('#sf button[type=submit]'); page.wait_for_timeout(500)
    check('charger-type filter works', page.locator('#list .station').count() == 1)
    page.select_option('#type', 'ALL'); page.click('#loc'); page.wait_for_selector('#list .badge:has-text("km")')
    km = page.locator('#list .station .badge:has-text("km")').all_inner_texts()
    vals = [float(k.split()[0]) for k in km]
    check('T06 nearby stations carry distances, nearest first', len(vals) >= 3 and vals == sorted(vals), km)
    shot(page, '04_nearby')

    print('FR-05 / FR-06 availability + booking')
    page.locator('#list .station').first.click(); page.wait_for_selector('.charger')
    shot(page, '05_station_slots')
    tomorrow = page.locator('.tabs button[data-d]').nth(1); tomorrow.click(); page.wait_for_selector('.slot')
    tmr_day = tomorrow.get_attribute('data-d')
    free = page.locator('.slot[data-k=free]')
    check('T07 free slots are shown for tomorrow', free.count() > 0)
    free.nth(5).click(); page.wait_for_selector('#modal:not([hidden]) [data-ok]')
    shot(page, '06_confirm_booking')
    page.click('#modal [data-ok]'); page.wait_for_selector('#toast .toast.success')
    check('T08 booking shows a confirmation message', 'confirmed' in toast_text(page).lower(), toast_text(page))
    page.wait_for_timeout(600)
    check('the grid reloads and marks my booking', page.locator('.slot.mine').count() == 1)
    shot(page, '07_booking_confirmed')

    print('FR-11 / FR-09 history + cancel')
    page.click('a[href="#/bookings"]'); page.wait_for_selector('.booking')
    check('T14 booking appears under Active', page.locator('.panel:has(h2:text("Active")) .booking').count() == 1)
    shot(page, '08_my_bookings')
    page.click('[data-cancel]'); page.click('#modal [data-ok]'); page.wait_for_selector('#toast .toast.success')
    page.wait_for_timeout(600)
    check('T10 cancel releases the booking (moves to History as cancelled)', page.locator('.panel:has(h2:text("History")) .badge.bad').count() == 1)
    shot(page, '09_cancelled')

    print('FR-07 double-booking demo')
    page.click('a[href="#/demo"]'); page.wait_for_selector('#ds option', state='attached')
    # choose a slot that userb has no booking near (sample data: userb holds tomorrow 11:00)
    opts = page.locator('#ds option').all()
    page.select_option('#ds', index=0)
    page.click('#go'); page.wait_for_selector('.race .result')
    texts = page.locator('.race .result').all_inner_texts()
    won = [t for t in texts if 'Booked' in t.split('\n')[0]]; lost = [t for t in texts if 'Rejected' in t.split('\n')[0]]
    check('T09 exactly one driver is Booked and one Rejected', len(won) == 1 and len(lost) == 1, texts)
    check('the loser sees SLOT_UNAVAILABLE', any('SLOT_UNAVAILABLE' in t for t in lost), lost)
    shot(page, '10_double_booking_demo')

    print('FR-10 charging session (slot that is running now)')
    tok = api('/auth/login', 'POST', {'login': 'HARRY', 'password': 'harry@123'})['data']['token']
    now = api('/stations/1/slots', token=tok)['data']['server_time']
    running = [s for s in api('/availability/slots?limit=100')['data'] if s['start_time'] <= now < s['end_time'] and s['station_id'] not in ()]
    if not running:
        adm = api('/auth/login', 'POST', {'login': 'admin@evcharge.test', 'password': 'Password@123'})['data']['token']
        h = int(now[11:13]); api('/admin/chargers/1/slots/generate', 'POST', {'date': now[:10], 'start_hour': h, 'end_hour': min(h + 1, 24), 'slot_minutes': 60}, adm)
        running = [s for s in api('/availability/slots?limit=100')['data'] if s['start_time'] <= now < s['end_time']]
    check('a running slot exists for the demo', len(running) > 0, now)
    sid = running[0]['station_id']
    page.goto(f'{BASE}/#/station/{sid}'); page.wait_for_selector('.charger')
    day_btn = page.locator('.tabs button.on'); 
    slot = page.locator(f'.slot[data-slot="{running[0]["slot_id"]}"]'); slot.click()
    page.click('#modal [data-ok]'); page.wait_for_selector('#toast .toast.success')
    page.click('a[href="#/bookings"]'); page.wait_for_selector('[data-start]')
    page.click('[data-start]'); page.wait_for_selector('[data-end]')
    check('T12 session started (End charging button appears)', page.locator('[data-end]').count() == 1)
    shot(page, '11_session_running')
    page.click('[data-end]'); page.wait_for_selector('#kwh'); page.fill('#kwh', '6.5'); page.click('#modal [data-ok]')
    page.wait_for_selector('.badge:has-text("completed")'); page.wait_for_timeout(500)
    hist = page.locator('.panel:has(h2:text("History")) .booking').first.inner_text()
    check('T13 end time / energy / cost stored and shown', '6.5 kWh' in hist and '₹' in hist, hist)
    shot(page, '12_session_completed')

    print('FR-13 admin')
    page.click('#logout'); page.wait_for_selector('#f')
    page.fill('#login', 'admin@evcharge.test'); page.fill('#password', 'Password@123'); page.click('button[type=submit]'); page.wait_for_selector('#list .station')
    page.click('a[href="#/admin"]'); page.wait_for_selector('.stat')
    check('admin overview shows statistics', page.locator('.stat').count() == 6)
    shot(page, '13_admin_overview')
    page.click('[data-t=stations]'); page.wait_for_selector('#sform')
    page.fill('#sform [name=name]', 'UI Test Station'); page.fill('#sform [name=address]', 'Rajiv Chowk, Delhi')
    page.fill('#sform [name=latitude]', '28.633'); page.fill('#sform [name=longitude]', '77.219'); page.click('#sform button')
    page.wait_for_selector('#toast .toast.success'); page.wait_for_timeout(500)
    check('T16 admin created a station and it is listed', 'UI Test Station' in page.inner_text('#tab'))
    new_id = [r for r in api('/admin/stations', token=api('/auth/login', 'POST', {'login': 'admin@evcharge.test', 'password': 'Password@123'})['data']['token'])['data'] if r['name'] == 'UI Test Station'][0]['station_id']
    page.fill('#cform [name=sid]', str(new_id)); page.fill('#cform [name=power_kw]', '30'); page.fill('#cform [name=price_per_kwh]', '15'); page.click('#cform button')
    page.wait_for_selector('#toast .toast.success'); page.wait_for_timeout(500)
    check('admin added a charger to the new station', page.locator('#tab table').nth(1).inner_text().count('\n') >= 10)
    shot(page, '14_admin_stations')
    page.click('[data-t=bookings]'); page.wait_for_selector('table'); shot(page, '15_admin_bookings')
    page.click('[data-t=slots]'); page.wait_for_selector('#lst')
    page.fill('#lst [name=date]', tmr_day); page.click('#lst button'); page.wait_for_selector('#slotlist .slot')
    first = page.locator('#slotlist .slot').first; first.click(); page.wait_for_selector('#toast .toast.success'); page.wait_for_timeout(500)
    check('T16 admin blocked a slot and the grid shows it blocked', 'blocked' in page.locator('#slotlist .slot').first.inner_text().lower())
    shot(page, '16_admin_slots')

    print('responsive layout (phone width 390 px)')
    page.set_viewport_size({'width': 390, 'height': 800})
    for name, url in [('stations', '#/'), ('station page', f'#/station/{sid}'), ('bookings', '#/bookings'), ('admin', '#/admin')]:
        page.goto(BASE + '/' + url); page.wait_for_timeout(700)
        over = page.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        check(f'phone width: no sideways scrolling on {name}', over <= 1, f'{over}px too wide')
        if name == 'station page': shot(page, '17_phone_station_page')

    check('no JavaScript errors in the browser console', not errors, errors)
    b.close()

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
sys.exit(1 if failed else 0)
