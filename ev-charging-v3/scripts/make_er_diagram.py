"""Draws the ER diagram from the REAL database (information_schema), so it can never disagree with the schema.
usage: python3 scripts/make_er_diagram.py <db> <mysql-user> <mysql-password> [out.png]"""
import subprocess, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

db, user, pw = sys.argv[1:4]
out = sys.argv[4] if len(sys.argv) > 4 else 'docs/ER_diagram.png'
def q(sql):
    r = subprocess.run(['mysql', f'-u{user}', f'-p{pw}', '-N', '-B', db, '-e', sql], capture_output=True, text=True, check=True)
    rows = [l.split('\t') for l in r.stdout.rstrip('\n').split('\n') if l]
    return [x + [''] * (5 - len(x)) if len(x) < 5 and 'extra' not in sql else x for x in rows]
cols = {}
for t, c, typ, key, extra in q("select table_name,column_name,column_type,column_key,extra from information_schema.columns where table_schema=database() order by table_name,ordinal_position"):
    cols.setdefault(t, []).append((c, typ, key, extra))
fks = {(t, c) for t, c, *_ in q("select table_name,column_name from information_schema.key_column_usage where table_schema=database() and referenced_table_name is not null")}

pos = {'charging_station': (0.2, 10.2), 'charger': (4.2, 10.2), 'charging_slot': (8.2, 10.2), 'booking': (12.2, 10.2), 'users': (16.2, 10.2),
       'app_setting': (0.2, 5.0), 'booking_audit': (8.2, 5.0), 'charging_session': (12.2, 5.0), 'payment': (16.2, 5.0)}
W, LH = 3.3, 0.34
fig, ax = plt.subplots(figsize=(20, 11.5)); ax.set_xlim(0, 20); ax.set_ylim(0, 11.3); ax.axis('off')
ax.text(0.2, 11.0, 'EV Charging Station Locator & Booking - ER diagram (generated from the live schema)', fontsize=15, weight='bold')
box = {}
for t, (x, ytop) in pos.items():
    rows = cols[t]; h = LH * (len(rows) + 1.2)
    ax.add_patch(Rectangle((x, ytop - h), W, h, fc='#f4f8f9', ec='#0b1b22', lw=1.6))
    ax.add_patch(Rectangle((x, ytop - LH * 1.2), W, LH * 1.2, fc='#0b6e78', ec='#0b1b22', lw=1.6))
    ax.text(x + W / 2, ytop - LH * 0.6, t, ha='center', va='center', color='white', weight='bold', fontsize=11)
    for i, (c, typ, key, extra) in enumerate(rows):
        tag = ('PK ' if key == 'PRI' else '') + ('FK ' if (t, c) in fks else '') + ('UQ ' if key == 'UNI' else '')
        col = '#7a4b00' if (t, c) in fks else '#0b1b22'
        gen = ' (generated)' if 'GENERATED' in extra.upper() else ''
        ax.text(x + 0.1, ytop - LH * (1.2 + i + 0.55), f'{tag}{c}{gen} : {typ.split(" ")[0]}', fontsize=8, va='center', color=col, weight='bold' if key == 'PRI' else 'normal')
    box[t] = (x, ytop - h, W, h)
C, G = '#0b1b22', '#0b6e78'
def lab(x, y, t, ha='center'): ax.text(x, y, t, color=G, weight='bold', fontsize=10, ha=ha)
def hline(a, b, ra, rb, la, lb):          # horizontal link between right edge of a and left edge of b (a is left of b)
    xa = box[a][0] + W; xb = box[b][0]; y = box[a][1] + box[a][3] - LH * 2
    ax.plot([xa, xb], [y, y], color=C, lw=1.5); lab(xa + 0.2, y + 0.1, la); lab(xb - 0.2, y + 0.1, lb)
hline('charging_station', 'charger', 0, 0, '1', 'N')
hline('charger', 'charging_slot', 0, 0, '1', 'N')
hline('charging_slot', 'booking', 0, 0, '1', 'N*')
hline('booking', 'users', 0, 0, 'N', '1')
bk = box['booking']; bx0, by = bk[0], bk[1]
# booking -> session: straight down from the middle
sx = box['charging_session']; ax.plot([bx0 + W / 2] * 2, [by, sx[1] + sx[3]], color=C, lw=1.5); lab(bx0 + W / 2 + 0.25, by - 0.25, '1'); lab(bx0 + W / 2 + 0.35, sx[1] + sx[3] + 0.1, '0..1')
# booking -> payment: elbow through the gap between the rows
py = box['payment']; ymid = (by + sx[1] + sx[3]) / 2 + 0.35
ax.plot([bx0 + W - 0.3, bx0 + W - 0.3, py[0] + W / 2, py[0] + W / 2], [by, ymid, ymid, py[1] + py[3]], color=C, lw=1.5)
lab(bx0 + W - 0.05, by - 0.25, '1'); lab(py[0] + W / 2 + 0.35, py[1] + py[3] + 0.1, '0..1')
# booking -> audit (logical link, dashed)
au = box['booking_audit']; ymid2 = ymid - 0.35
ax.plot([bx0 + 0.3, bx0 + 0.3, au[0] + W / 2, au[0] + W / 2], [by, ymid2, ymid2, au[1] + au[3]], color='#6b7b83', lw=1.2, ls='--')
ax.text(au[0] + W / 2 + 0.2, ymid2 + 0.1, 'booking_id (logged by triggers, no FK)', fontsize=8.5, color='#4a5a62')
ax.text(0.2, 0.5, 'PK = primary key   FK = foreign key (amber)   UQ = unique.   N* = a slot has many booking rows over time but AT MOST ONE active (CONFIRMED / IN_PROGRESS):\n'
        'enforced by UNIQUE(booking.active_slot_id), a generated column that is NULL for cancelled/completed rows.   app_setting stores business rules (cancel cut-off, session early start).',
        fontsize=9, color='#4a5a62')
fig.savefig(out, dpi=110, bbox_inches='tight'); print('wrote', out)
