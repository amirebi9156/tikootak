#!/usr/bin/env python3
# افزودن ترجمهٔ انگلیسی: python3 add-en.py '{"فارسی":"English", ...}'  (کلیدهای تکراری رد می‌شوند)
import sys, json
add = json.loads(sys.argv[1]); p = 'src/en.js'; s = open(p, encoding='utf8').read()
new = {k: v for k, v in add.items() if json.dumps(k, ensure_ascii=False) + ':' not in s}
i = s.rindex('\n};'); head = s[:i].rstrip()
if not head.endswith(','): head += ','
body = ',\n'.join(' %s: %s' % (json.dumps(k, ensure_ascii=False), json.dumps(v, ensure_ascii=False)) for k, v in new.items())
open(p, 'w', encoding='utf8').write(head + ('\n' + body if body else '') + '\n};\n'); print('added', len(new))
