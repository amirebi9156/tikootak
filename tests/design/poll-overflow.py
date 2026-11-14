"""Poll card must stay inside its chat bubble (received bubble with avatar is narrower than the old 280px min-width)."""
import sys, glob, os, json, tempfile
from playwright.sync_api import sync_playwright

# Run after: cd web-src && npx vite build. Usage: python3 -I tests/design/poll-overflow.py
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
css = glob.glob(os.path.join(ROOT, "web", "dist", "assets", "index-*.css"))[0]
OUT = tempfile.mkdtemp(prefix="poll-")

def poll(q, opts, pct):
    o = "".join(f'<button type="button" class="poll-opt"><span class="po-bar" style="width:{p}%"></span><span class="po-mark"></span><span class="po-text" dir="auto">{t}</span><span class="po-pct">{p}٪</span></button>' for t, p in zip(opts, pct))
    return f'<div class="poll-card"><strong class="poll-q" dir="auto">{q}</strong><span class="poll-sub">تک‌پاسخ — ۲ رأی</span><div class="poll-list">{o}</div></div>'

def msg(kind, body):
    av = '<span class="msg-av"><span class="avatar">A</span></span><span class="msg-name">arsln</span>' if kind == "theirs" else ""
    return f'<div class="msg {kind} tail">{av}<div class="bubble">{body}<span class="msg-time">01:28 AM</span></div></div>'

CASES = [
  ("short",  poll("ارسلان سفیده؟", ["بله", "نخیر(بله)"], [50, 50])),
  ("long",   poll("امیر ک.نیه و این یک سؤال بسیار طولانی است که باید خط بخورد و از کادر بیرون نزند؟", ["صد درصد بله و همین‌طور ادامه دارد تا چند خط", "نه"], [70, 30])),
  ("unbreakable", poll("ok", ["A"*60, "b"], [10, 90])),
]
rows = "".join(msg("theirs", b) + msg("mine", b) for _, b in CASES)
HTML = f'<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="file://{css}"></head><body><div class="shell" data-view="chat"><aside class="sidebar"></aside><main class="main"><div class="chat"><div class="timeline">{rows}</div></div></main></div></body></html>'
page_path = os.path.join(OUT, "h.html"); open(page_path, "w").write(HTML)

JS = """() => [...document.querySelectorAll('.msg')].map((m, i) => {
  const b = m.querySelector('.bubble'), br = b.getBoundingClientRect(), c = b.querySelector('.poll-card').getBoundingClientRect();
  const cs = getComputedStyle(b), pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight);
  const opts = [...b.querySelectorAll('.poll-opt')].map(o => o.getBoundingClientRect());
  const inner = { l: br.left + pl, r: br.right - pr };
  const over = Math.max(0, inner.l - Math.min(c.left, ...opts.map(o => o.left)), Math.max(c.right, ...opts.map(o => o.right)) - inner.r);
  return { kind: m.classList.contains('theirs') ? 'theirs' : 'mine', idx: Math.floor(i/2), bubbleW: Math.round(br.width), cardW: Math.round(c.width), overflowPx: Math.round(over * 10) / 10,
           scrollOver: b.scrollWidth - b.clientWidth, offscreen: br.left < -0.5 || br.right > innerWidth + 0.5 };
})"""

fails = 0
with sync_playwright() as p:
    br = p.chromium.launch()
    for vw, vh, mob in [(390, 844, True), (360, 740, True), (320, 640, True), (1280, 800, False)]:
        ctx = br.new_context(viewport={"width": vw, "height": vh}, is_mobile=mob, has_touch=mob, device_scale_factor=2)
        pg = ctx.new_page(); pg.goto("file://" + page_path); pg.wait_for_timeout(300)
        res = pg.evaluate(JS)
        pg.screenshot(path=os.path.join(OUT, f"poll_{vw}.png"), full_page=True)
        for r in res:
            bad = r["overflowPx"] > 0.5 or r["scrollOver"] > 0 or r["offscreen"]
            fails += bad
            print(f'{vw:5d}px {CASES[r["idx"]][0]:11s} {r["kind"]:6s} bubble={r["bubbleW"]:4d} card={r["cardW"]:4d} overflow={r["overflowPx"]:5.1f}px scrollOver={r["scrollOver"]} {"FAIL" if bad else "ok"}')
        ctx.close()
    br.close()
print("shots:", OUT); print("FAILS:", fails); sys.exit(1 if fails else 0)
