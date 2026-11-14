"""Static harness (real built CSS): top-docked mini player layout (no seek/play overlap, edge gaps) and Instagram-like reel side buttons.
Run after: cd web-src && npx vite build.   Usage: python3 -I tests/design/player-reel.py [outdir]"""
import sys, glob, os, tempfile
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
css = glob.glob(os.path.join(ROOT, "web", "dist", "assets", "index-*.css"))[0]
OUT = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp(prefix="player-reel-")
os.makedirs(OUT, exist_ok=True)
def ico(d, fill=False): return f'<svg class="ico" viewBox="0 0 24 24" width="28" height="28" fill="{"currentColor" if fill else "none"}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="{d}"/></svg>'
HEART="M12 21s-7-4.4-9.4-8.4A5.4 5.4 0 0 1 12 5.2a5.4 5.4 0 0 1 9.4 7.4C19 16.6 12 21 12 21z"
CMT="M12 3a9 9 0 1 0 0 18c1.5 0 2.9-.35 4.15-.98L21 21l-1.5-4.6A9 9 0 0 0 12 3z"
SEND="M21 3 10 14M21 3l-7 18-4-7-7-4z"; DOTS='<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>'
PLAYER = '''<div class="player-bar mp lg" role="region"><button type="button" class="plainbtn mp-open mini-open"><span class="cover" style="width:44px;height:44px;background:#556;display:block"></span><span class="mp-meta"><strong dir="auto">Hichvaght Nabashe</strong><span dir="auto">Arianfar · long artist name here</span></span></button>
<div class="mp-seek" dir="ltr"><span class="clock num">0:20</span><input type="range" class="seek" min="0" max="200" value="40" style="--p:20%"><span class="clock num">-2:40</span></div>
<div class="mp-ctl" dir="ltr"><button class="mp-b mp-skip">⏮</button><button class="mp-b mp-pp" data-testid="pp">❚❚</button><button class="mp-b mp-skip">⏭</button></div>
<div class="mp-end"><button class="mp-b mp-float">▭</button><button class="mp-b">✕</button></div></div>'''
REEL = f'''<div class="feed full"><section class="reel"><div class="reel-media" style="background:#333"></div>
<div class="reel-side"><button class="rbtn on">{ico(HEART, True)}<span>۲</span></button><button class="rbtn">{ico(CMT)}<span>۳</span></button><button class="rbtn">{ico(SEND)}<span>&nbsp;</span></button><button class="rbtn">{ico(DOTS)}<span>&nbsp;</span></button></div></section></div>'''
def page(inner, view): return f'<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="file://{css}"></head><body><div class="shell" data-view="{view}" data-bar="on">{inner}</div></body></html>'
FEED = page(f'<aside class="sidebar"></aside><main class="main">{PLAYER}{REEL}</main>', 'chat')
LIST = page(f'<aside class="sidebar"><header class="side-head"><strong>TIKOOTAK</strong></header>{PLAYER}<div style="padding:16px">chat list</div></aside><main class="main"></main>', 'list')
fails = 0
def chk(name, ok):
    global fails; print(("PASS " if ok else "FAIL ") + name); fails += 0 if ok else 1
with sync_playwright() as p:
    b = p.chromium.launch()
    for label, html, vw in (("feed390", FEED, 390), ("list390", LIST, 390), ("feed1100", FEED, 1100)):
        path = os.path.join(OUT, label + ".html"); open(path, "w").write(html)
        pg = b.new_context(viewport={"width": vw, "height": 800}, is_mobile=vw < 500, has_touch=vw < 500).new_page()
        pg.goto("file://" + path); pg.wait_for_timeout(500)
        r = pg.evaluate("""() => { const q = s => document.querySelector(s); const bar = q('.player-bar.mp'); if (!bar) return null;
          const R = e => e.getBoundingClientRect(); const bb = R(bar), pp = R(q('.mp-pp')), sk = R(q('.mp-seek .seek')), cs = getComputedStyle(bar);
          const side = q('.reel-side'); const btns = side ? [...side.querySelectorAll('.rbtn')].map(R) : [];
          return { bar: [bb.left, bb.right, bb.top, bb.bottom], pp: [pp.top, pp.bottom], seek: [sk.top, sk.bottom], vis: cs.display, vw: innerWidth,
                   icons: side ? [...side.querySelectorAll('.ico')].map(i => R(i).width) : [], btns: btns.map(x => [x.top, x.bottom]) }; }""")
        pg.screenshot(path=os.path.join(OUT, label + ".png"))
        chk(f"{label}: player visible", r is not None and r["vis"] != "none")
        if not r: continue
        if vw < 500:
            chk(f"{label}: edge gap <= 12px", r["bar"][0] <= 12 and r["vw"] - r["bar"][1] <= 12)
            chk(f"{label}: seek does not overlap play button", r["seek"][0] >= r["pp"][1] - 1)
        else:
            chk(f"{label}: bar at top of main", r["bar"][2] < 40)
        if r["icons"]:
            print("icon widths", r["icons"]); chk(f"{label}: all reel icons 28px", all(abs(w - 28) < 2 for w in r["icons"]))
            gaps = [r["btns"][i + 1][0] - r["btns"][i][1] for i in range(len(r["btns"]) - 1)]
            chk(f"{label}: even rhythm", max(gaps) - min(gaps) < 1.5 and min(gaps) >= 14)
    b.close()
print("shots in", OUT); print("FAIL=%d" % fails); sys.exit(fails)
