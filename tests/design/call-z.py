"""Regression: the call view must paint above the chat composer / chat-top (call controls were hidden under the glass composer, z-index 6 vs 31)."""
import sys, glob, os, json, tempfile
from playwright.sync_api import sync_playwright

# Run after: cd web-src && npx vite build   (needs web/dist). Usage: python3 -I tests/design/call-z.py
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIST = os.path.join(ROOT, "web", "dist", "assets")
css = glob.glob(os.path.join(DIST, "index-*.css"))[0]
SP = tempfile.mkdtemp(prefix="call-z-")

HTML = f"""<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="file://{css}"></head><body>
<div class="shell" data-view="chat"><aside class="sidebar"></aside>
<main class="main">
  <div class="chat">
    <div class="chat-top"><header class="chat-head"><strong>Room</strong></header></div>
    <div class="msgs" style="flex:1;overflow:auto"><p>hello</p></div>
    <form class="composer"><div class="cpill lg"><div class="attach-wrap"><button type="button" class="icon">A</button></div><textarea rows="1" placeholder="msg"></textarea><div class="emoji-wrap"><button type="button" class="icon">E</button></div></div><button type="button" class="send mic">M</button></form>
  </div>
  <section class="call">
    <header class="call-head"><button class="ghost">back</button><strong>Call</strong></header>
    <div class="grid" data-count="1"><div class="tile"></div></div>
    <footer class="call-controls">
      <button class="ctl" id="b-mic">M</button><button class="ctl" id="b-cam">C</button>
      <button class="ctl" id="b-scr">S</button><button class="ctl danger" id="b-end">X</button>
    </footer>
  </section>
</main></div></body></html>"""
open(os.path.join(SP, "call_harness.html"), "w").write(HTML)

def run(browser, label, vw, vh, mobile, force_old):
    ctx = browser.new_context(viewport={"width": vw, "height": vh}, is_mobile=mobile, has_touch=mobile)
    pg = ctx.new_page()
    pg.goto("file://" + os.path.join(SP, "call_harness.html"))
    if force_old:
        pg.add_style_tag(content=".call{z-index:6 !important}")
    pg.wait_for_timeout(300)
    res = pg.evaluate("""() => {
      const out = {};
      out.callZ = getComputedStyle(document.querySelector('.call')).zIndex;
      out.composerZ = getComputedStyle(document.querySelector('form.composer')).zIndex;
      for (const id of ['b-mic','b-cam','b-scr','b-end']) {
        const el = document.getElementById(id), r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
        out[id] = el === top || el.contains(top);
      }
      const c = document.querySelector('.call'), cr = c.getBoundingClientRect();
      let bad = 0, total = 0;
      for (let i = 1; i < 24; i++) for (let j = 1; j < 48; j++) {
        const x = cr.x + cr.width * i / 24, y = cr.y + cr.height * j / 48;
        const t = document.elementFromPoint(x, y); total++;
        if (t && !c.contains(t)) bad++;
      }
      out.leak = bad; out.samples = total;
      return out;
    }""")
    pg.screenshot(path=os.path.join(SP, f"call_{label}.png"))
    ctx.close()
    ok = all(res[k] for k in ['b-mic','b-cam','b-scr','b-end']) and res['leak'] == 0
    print(f"{label:22s} call z={res['callZ']:>3} composer z={res['composerZ']:>3}  OK={ok} leaked-points={res['leak']}/{res['samples']}  {json.dumps({k:res[k] for k in ['b-mic','b-cam','b-scr','b-end']})}")
    return ok

with sync_playwright() as p:
    b = p.chromium.launch()
    results = {}
    for name, vw, vh, mob in [("mobile390", 390, 844, True), ("desktop1280", 1280, 800, False)]:
        results[name+"_before"] = run(b, name+"_before", vw, vh, mob, True)
        results[name+"_after"]  = run(b, name+"_after",  vw, vh, mob, False)
    b.close()
bad = results["mobile390_before"] or results["desktop1280_before"]
good = results["mobile390_after"] and results["desktop1280_after"]
print("\nbug reproduced in 'before':", not bad, "| fixed in 'after':", good)
sys.exit(0 if (good and not bad) else 1)
