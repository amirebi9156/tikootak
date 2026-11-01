# راهنمای عیب‌یابی TIKOOTAK

این راهنما برای وقتیه که چیزی خراب شده و خودت می‌خوای درستش کنی، حتی بدون اینترنت و بدون هوش مصنوعی.
همه دستورها را داخل پوشه پروژه (`cd ~/tikootak`) بزن.

## ۰. اول این را اجرا کن

```bash
./scripts/doctor.sh
```

(اگه گفت Docker در دسترس نیست: `sudo ./scripts/doctor.sh`)

هر خط یکی از این سه حالت را دارد:
- ✔ سالم است.
- ! هشدار است (کار می‌کند ولی باید به آن رسیدگی کنی).
- ✘ مشکل دارد. زیرش پیشنهاد رفع نوشته شده. از **اولین** ✘ شروع کن، چون معمولاً بقیه از آن ناشی می‌شوند.

## ۱. نقشه سیستم

```
مرورگر کاربر
   │  https (پورت 443)
   ▼
 Caddy ──► /            ──► فایل‌های UI (web/dist)
        ├► /api/*       ──► Gateway  (ثبت‌نام، ورود، توکن تماس، کد دعوت)
        ├► /_matrix/*   ──► Synapse ──► Postgres  (چت و حساب‌ها)
        └► /livekit/*   ──► LiveKit  (آغاز تماس)

صدا و تصویر تماس مستقیم به LiveKit می‌رود: پورت‌های 7882/udp ، 7881/tcp ، 3478/udp ، 30000-30100/udp
```

دیتای واقعی فقط در این پوشه‌هاست (container ها فقط پوسته‌اند و هر وقت خواستی پاک و دوباره ساخته می‌شوند):

| پوشه | چی داخلشه |
|---|---|
| `data/postgres` | حساب‌ها، اتاق‌ها، پیام‌ها |
| `data/synapse` | کلید امضای سرور و فایل‌های آپلودشده |
| `data/gateway` | کدهای دعوت |
| `.env` | همه رمزها (**جایی امن هم از آن نسخه بگیر**) |

## ۲. دستورهای روزمره

| کار | دستور |
|---|---|
| وضعیت سرویس‌ها | `docker compose ps` |
| لاگ یک سرویس | `docker compose logs --tail 50 synapse` (نام‌ها: `caddy gateway synapse postgres livekit`) |
| لاگ زنده (خروج با Ctrl+C) | `docker compose logs -f gateway` |
| ری‌استارت یک سرویس | `docker compose restart gateway` |
| ساخت دوباره یک سرویس | `docker compose up -d --force-recreate caddy` |
| خاموش کردن همه (دیتا می‌ماند) | `docker compose down` |
| روشن کردن همه | `docker compose up -d` |
| رفتن داخل یک سرویس | `docker compose exec gateway sh` (خروج: `exit`) |
| بکاپ | `sudo ./scripts/backup.sh` |
| کد دعوت جدید | دستور بخش ۴ |

> وقتی فایلی را که به container وصل است **جایگزین** می‌کنی (با `tar`، `cp` یا `git pull`)، `restart` کافی نیست و باید `--force-recreate` بزنی. اگه فقط داخل فایل را با `nano` ویرایش کردی، `restart` کافی است.

## ۳. علامت ← علت ← راه‌حل

### سایت اصلاً باز نمی‌شود
1. `docker compose ps`: کدام سرویس بالا نیست؟ `docker compose up -d`
2. اگه caddy بالاست: `docker compose logs --tail 30 caddy`
3. از **بیرون سرور** امتحان کن. اگه روی خود سرور باز می‌شود ولی از بیرون نه: دامنه به IP درست اشاره نمی‌کند (DNS) یا پورت‌های 80 و 443 در فایروال بسته‌اند، یا IP سرور فیلتر شده (بخش ۵: جابجایی).

### مرورگر هشدار امنیتی/گواهی می‌دهد
- روی `localhost` عادی است (گواهی خودامضا).
- روی سرور واقعی: Caddy نتوانسته گواهی بگیرد. `docker compose logs --tail 30 caddy`. اگه سرور به Let's Encrypt دسترسی ندارد، گواهی دستی بگذار (`certs/cert.pem` و `certs/key.pem`) و در `.env` بنویس `CADDYFILE=./Caddyfile.manual-cert` و بعد `docker compose up -d --force-recreate caddy`.

### «کد دعوت معتبر نیست»
- کد منقضی شده، ظرفیتش پر شده یا باطل شده. کد جدید بساز (بخش ۴).
- کد را با حروف بزرگ و با خط تیره وارد کن: `XXXXX-XXXXX`.

### «تلاش‌های زیاد» موقع ثبت‌نام یا ورود
- محدودیت پیش‌فرض: ۱۰ ثبت‌نام در ساعت و ۳۰ ورود در ۱۵ دقیقه **برای هر IP**. چند دوستی که پشت یک IP هستند (اینترنت موبایل) سهم مشترک دارند.
- فوری: `docker compose restart gateway` (شمارنده صفر می‌شود).
- دائمی: در `.env` مقدار `RATE_REGISTER_PER_HOUR=50` را بگذار و `docker compose up -d gateway`.

### وارد می‌شوم ولی نوشته «اتصال قطع شد» یا پیام‌ها نمی‌آیند
1. `docker compose logs --tail 50 synapse` و `docker compose logs --tail 20 postgres`
2. اگه postgres هنوز در حال راه‌اندازی است: صبر کن یا `docker compose restart synapse`
3. اگه دیسک پر است: بخش «دیسک پر شده».

### تماس وصل نمی‌شود («به تماس وصل نشد»)
1. `docker compose logs --tail 50 gateway`: اگه `upstream_unavailable` یا خطای Synapse هست، مشکل از چت است نه LiveKit.
2. `docker compose logs --tail 50 livekit`: ببین بالا آمده یا نه.
3. مرورگر: آدرس سایت باید `https://` باشد (یا localhost).

### تماس وصل می‌شود ولی صدا یا تصویر نمی‌رسد
تقریباً همیشه مشکل پورت یا IP است:
1. `PUBLIC_IP` در `.env` باید IP **عمومی** همین سرور باشد (نه IP داخلی). اگه عوضش کردی: `sudo ./scripts/install.sh`
2. در فایروال سرور (و پنل ارائه‌دهنده سرور) این پورت‌ها باز باشند: `7881/tcp` ، `7882/udp` ، `3478/udp` ، `30000-30100/udp`
3. `./scripts/doctor.sh` مشکل «PUBLIC_IP یکی نیست» را نشان می‌دهد.
4. اگه فقط بعضی کاربران صدا ندارند (مثلاً با موبایل): UDP روی شبکه آن‌ها محدود است. این محدودیت فعلی شبکه است و راه‌حلش TURN روی TLS در پورت 443 است که هنوز اضافه نشده.

### میکروفون یا دوربین کار نمی‌کند
- مرورگر فقط روی HTTPS معتبر (یا localhost) اجازه می‌دهد. با `http://` یا گواهی نامعتبر کار نمی‌کند.
- دسترسی میکروفون را در تنظیمات سایت مرورگر بده (آیکون قفل کنار آدرس).

### بعد از ری‌استارت سرور هیچ‌چیز بالا نیامد
```bash
sudo systemctl enable docker      # یک بار؛ تا Docker با بوت سرور بالا بیاید
docker compose up -d
```
سرویس‌ها `restart: unless-stopped` دارند و با بالا آمدن Docker خودشان بالا می‌آیند.

### دیسک پر شده
```bash
df -h .                                  # چقدر جا مانده
du -sh data/* backups/                   # چه چیزی بزرگ است
ls -1t backups/tikootak-*.tar.gz | tail -n +4 | xargs -r rm --     # فقط ۳ بکاپ آخر بماند
docker system prune -f                   # ایمیج‌ها و کش‌های بلااستفاده داکر
```

### کاربری رمزش را فراموش کرده
```bash
# ۱) هش رمز جدید را بساز (رمز را می‌پرسد)
docker compose exec synapse hash_password -c /data/homeserver.yaml
```
خروجی چیزی مثل `$2b$12$...` است. کپی‌اش کن و در دستور زیر به جای `PASTE_HASH_HERE` بگذار.
نام کاربر و دامنه را هم عوض کن (دامنه همان `DOMAIN` در `.env` است):
```bash
docker compose exec -T postgres psql -U synapse -d synapse <<'SQL'
UPDATE users SET password_hash='PASTE_HASH_HERE' WHERE name='@ali:chat.example.ir';
SQL
```
باید `UPDATE 1` ببینی. بعد کاربر با رمز جدید وارد می‌شود. (نکته: داخل `<<'SQL'` علامت‌های `$` دست نمی‌خورند.)

### `Permission denied`
فایل‌های `data/` مال کاربر خود container هستند. دستور را با `sudo` بزن.

## ۴. ساخت کد دعوت

این دستور بدون نیاز به دامنه و گواهی کار می‌کند، چون از داخل خود container می‌زند:
```bash
docker compose exec gateway node -e "fetch('http://localhost:3000/api/admin/invites',{method:'POST',headers:{'content-type':'application/json','x-admin-key':process.env.GATEWAY_ADMIN_KEY},body:JSON.stringify({max_uses:5,expires_days:7,note:'دوستان'})}).then(r=>r.json()).then(j=>console.log(j.code))"
```
`max_uses` تعداد نفراتی است که با این کد می‌توانند ثبت‌نام کنند و `expires_days` اعتبار به روز.

لیست کدها و تعداد مصرف:
```bash
docker compose exec gateway node -e "fetch('http://localhost:3000/api/admin/invites',{headers:{'x-admin-key':process.env.GATEWAY_ADMIN_KEY}}).then(r=>r.json()).then(j=>console.table(j))"
```

## ۵. جابجایی به سرور جدید (وقتی سرور فیلتر شد)

راهنمای کامل: `docs/MIGRATION.md`. دستور اصلی (روی سرور فعلی): `./scripts/migrate.sh root@IP_جدید --offline --final` و بعد عوض‌کردن DNS.
دستی: `./scripts/restore.sh --dry-run <بکاپ>` برای بررسی و بعد `./scripts/restore.sh --ip IP_جدید <بکاپ>`. فایل‌های بکاپ حالا رمزشده‌اند (`.enc`)؛ کلید `BACKUP_PASSPHRASE` را جدا نگه دار.

## ۶. به‌روزرسانی

- **کد رابط کاربری یا اسکریپت‌ها** (فایل tar جدید): `sudo tar -xzf <فایل>` و بعد `sudo ./scripts/install.sh` (امن است؛ دیتا دست نمی‌خورد و سرویس‌ها از نو ساخته می‌شوند).
- **نسخه سرویس‌های اصلی** (Synapse، Caddy، LiveKit): `docker compose pull && docker compose up -d`. قبلش بکاپ بگیر.

## ۷. کیت بقا (اگه اینترنت قطع شد، این‌ها را از قبل داشته باش)

1. پوشه پروژه (کد + اسکریپت‌ها)
2. `images.tar.gz` (از `./scripts/save-images.sh`؛ بدون آن Docker نمی‌تواند سرویس‌ها را دوباره بسازد)
3. جدیدترین فایل بکاپ
4. فایل `.env`
5. گواهی دستی (`certs/`) اگه استفاده می‌کنی
6. همین راهنما (چاپ‌شده یا روی گوشی)

این‌ها را روی یک فلش یا حداقل یک جای دیگر غیر از خود سرور نگه دار. بکاپی که فقط روی همان سرور باشد، با از دست رفتن سرور از بین می‌رود.

## ۸. وقتی هیچ‌چیز جواب نداد

ریست کامل بدون پاک کردن دیتا:
```bash
docker compose down
sudo ./scripts/install.sh
./scripts/doctor.sh
```
اگه باز هم نشد، لاگ اولین سرویس ✘ را (`docker compose logs --tail 100 <سرویس>`) نگه دار تا بتوانی برای کمک بفرستی.

## رمزنگاری پیام‌ها: مشکلات رایج

- **«این پیام رمزگشایی نشد»**: کلید آن پیام روی این مرورگر نیست. بنر «بازیابی» را بزن و کلید بازیابی را وارد کن. اگر کلید را گم کرده، آن پیام‌ها برای همیشه نخواندنی‌اند (این هدف رمزنگاری سرتاسری است). پیام‌های جدید معمولاً درست می‌شوند.
- **مهاجرت سرور**: چیزی لازم نیست؛ بکاپ همان `.tar.gz` کافی است. پیام‌ها رمزشده ذخیره شده‌اند و کلیدها دست کاربرها است.
- **تأیید**: روی سرور `docker compose exec postgres psql -U synapse -c "select type,count(*) from events group by 1;"` را بزن؛ `m.room.encrypted` یعنی متن روی سرور رمز است.

## مدیریت محتوا و کاربران

ابزار: `./scripts/admin.sh` (بدون آرگومان، راهنما را نشان می‌دهد).

- مشکل محتوایی (پست یا آهنگ نامناسب): `./scripts/admin.sh posts` یا `tracks` → شناسه را پیدا کن → `delpost <id>` یا `deltrack <id>`.
- کاربر مزاحم: `./scripts/admin.sh wipe <کاربر>` همه محتوایش را پاک می‌کند، `./scripts/admin.sh ban <کاربر>` حسابش را می‌بندد (ورود ممنوع، نشست‌ها بسته؛ Synapse یک بار ری‌استارت می‌شود).
- ban برای پیام‌های چت چیزی را پاک نمی‌کند. اتاق‌ها رمزنگاری‌اند و مدیر نمی‌تواند محتوایشان را ببیند یا پاک کند، فقط کاربر را بیرون می‌اندازد.
- آمار و حجم دیسک: `./scripts/admin.sh stats`. اگر `feed_mb` یا `music_mb` زیاد شد، پست‌های حجیم را با `delpost` پاک کن.

## سخت‌کردن سرور و پایش (S5)
```bash
sudo ./scripts/harden-host.sh --dry-run          # اول ببین چه می‌کند
sudo ./scripts/harden-host.sh                    # فایروال + fail2ban + به‌روزرسانی امنیتی + SSH
sudo ./scripts/harden-host.sh --block-turn-internal   # (اختیاری) بستن مسیر داخلی TURN
sudo ./scripts/install-monitor.sh                # پایش هر ۵ دقیقه + بکاپ شبانه
```
اعلان خرابی: در `.env` یکی از `ALERT_WEBHOOK_URL` یا `ALERT_BOT_TOKEN` + `ALERT_CHAT_ID` را پر کن (برای «بله»: `ALERT_API_BASE=https://tapi.bale.ai`).
هشدار: `--ssh-keys-only` ورود با رمز را می‌بندد؛ اول با کلید در ترمینال دیگر وارد شو و تست کن.

## نسخهٔ اسکیما
`./scripts/doctor.sh` و `sudo tikootak status` نسخهٔ `schema_migrations` را نشان می‌دهند. اگر gateway با `DB_SCHEMA_TOO_NEW` بالا نیامد، کد قدیمی‌تر از داده است؛ کد جدیدتر نصب کن یا از بکاپ استفاده کن.
