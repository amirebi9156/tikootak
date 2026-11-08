# نصب TIKOOTAK روی سرور (Ubuntu/Debian) با دامنهٔ خودت

## ⚡ نصب با یک خط (پیشنهادی)
روی سرور تازه (Ubuntu/Debian) به‌عنوان root:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/amirebi9156/tikootak/main/install.sh)
```
اسکریپت می‌پرسد:
1. **حالت نصب:** `1) آنلاین` (آخرین Release را خودش از GitHub می‌گیرد) یا `2) آفلاین` (فایل کیت را خودت با scp/WinSCP روی سرور گذاشته‌ای؛ مسیرش را خودکار پیدا می‌کند یا می‌پرسد).
2. **دامنه** (رکورد A باید از قبل به همین سرور اشاره کند).
3. **بکاپ** (اگر از سرور قدیمی می‌آیی: مسیر فایل `.enc`؛ وگرنه Enter).

بعد خودش `bootstrap.sh` را اجرا می‌کند و در صورت دادن بکاپ، بازیابی را هم انجام می‌دهد.

بدون سؤال (برای اسکریپت‌نویسی):
```bash
# آنلاین
bash <(curl -fsSL URL/install.sh) --online --domain example.com --yes
# آفلاین با فایل آپلود‌شده + بازیابی بکاپ
bash install.sh --offline --file /root/tikootak-full-X.Y.Z.tar --domain example.com --restore /root/backup.enc --yes
```
گزینه‌های دیگر: `--version X.Y.Z`، `--mirror-base URL` (آینهٔ خودت به‌جای GitHub)، `--dir`، و هر گزینهٔ `bootstrap.sh` مثل `--mirror https://docker.arvancloud.ir`.

**اگر مخزن private است:** آدرس raw بدون توکن باز نمی‌شود. توکن fine-grained (فقط همین مخزن، دسترسی `Contents: read`) بساز و روی سرور بزن (توکن را جایی در چت نفرست):
```bash
export TOKEN=github_pat_xxx
bash <(curl -fsSL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github.raw" "https://api.github.com/repos/amirebi9156/tikootak/contents/install.sh?ref=main")
```
(اسکریپت اگر توکن را نداشته باشد خودش می‌پرسد و آن را در `.update.conf` با دسترسی ۶۰۰ نگه می‌دارد تا `tikootak update` کار کند.)
اگر GitHub روی سرور فیلتر است: حالت آفلاین را انتخاب کن (یا فایل `install.sh` را هم با scp ببر و `bash install.sh` بزن).

## ۰) پیش‌نیاز
- سرور حداقل ۲ هسته، ۴ گیگ رم، ۲۰ گیگ دیسک؛ Ubuntu 22.04/24.04 یا Debian 12.
- دسترسی root یا sudo با SSH.
- دامنه (مثلاً `tikootak.ir`).

## ۱) DNS (آروان)
پنل آروان ← دامنه ← DNS: یک رکورد **A** برای `@` (و اگر خواستی `www`) با مقدار IP سرور.
ابر را **خاکستری (DNS only)** بگذار، نه نارنجی. گواهی HTTPS با ابر نارنجی خودکار نمی‌گیرد و تماس‌های صوتی هم کار نمی‌کنند.

## ۲) فایروال (پنل ابر آروان ← گروه امنیتی)
`22/tcp  80/tcp  443/tcp  7881/tcp  7882/udp  3478/udp  30000-30100/udp`

## ۳) بردن فایل روی سرور
از کامپیوتر خودت (ویندوز PowerShell یا لینوکس/مک):
```bash
scp tikootak-full-X.Y.Z.tar root@IP_SERVER:/root/
```
(در ویندوز می‌توانی از WinSCP هم استفاده کنی.)

## ۴) نصب
```bash
ssh root@IP_SERVER
tar -xf tikootak-full-X.Y.Z.tar && cd tikootak
./scripts/bootstrap.sh --domain tikootak.ir --yes
```
اسکریپت خودش: سرور را بررسی می‌کند، DNS را چک می‌کند، Docker نصب می‌کند، (اگر Docker Hub بسته بود آینه امتحان می‌کند)، فایروال و fail2ban را می‌گذارد، سرویس‌ها را بالا می‌آورد، گواهی HTTPS می‌گیرد، بکاپ شبانه می‌گذارد و تست امنیت اجرا می‌کند.
اگر کیت کامل (`tikootak-full-*.tar`) را داشته باشی، همه‌چیز **آفلاین** نصب می‌شود (بدون GitHub/Docker Hub/npm/apt؛ حتی Docker از بسته‌های داخل کیت). در غیر این صورت اگر Docker Hub یا npm باز نبود، پیام می‌دهد؛ گزینه‌ها: `--mirror https://docker.arvancloud.ir`، `--npm <آینه>`، `sudo tikootak mirrors test`، یا کیت آفلاین. گواهی آماده داری؟ `--cert fullchain.pem --key key.pem`. جزئیات: `docs/OFFLINE-FA.md`.

در پایان این‌ها چاپ می‌شود: **کد دعوت اول**، **کلید ادمین** و **کلید رمز بکاپ**. هر دو کلید را بیرون از سرور هم ذخیره کن.

## ۵) بعد از نصب
- سایت: `https://tikootak.ir` ← ثبت‌نام با کد دعوت.
- پنل ادمین: `https://tikootak.ir/admin.html` (با کلید ادمین).
- مدیریت: `sudo tikootak` (منو)، `tikootak status`، `tikootak logs`.

## ۶) آپدیت‌های بعدی
فایل tar جدید را با `scp` ببر روی سرور و:
```bash
sudo tikootak update /root/tikootak-full-X.Y.Z.tar    # کیت آفلاین یا tar.gz معمولی؛ فایل .sha256 کنارش خودکار چک می‌شود
```
قبل از آپدیت بکاپ گرفته می‌شود و اگر خراب شد خودکار برمی‌گردد. `.env` و داده‌ها حفظ می‌شوند.

## ۷) عوض کردن سرور (اگر فیلتر شد)
روی سرور قدیم: `sudo tikootak backup` و فایل بکاپ را بردار. روی سرور جدید: مراحل ۳ و ۴ (با کیت کامل بدون اینترنت هم می‌شود)، بعد `sudo tikootak restore <فایل>` (گواهی ذخیره‌شده در `certs/` هم برمی‌گردد)، سپس رکورد A دامنه را به IP جدید بده.

## عیب‌یابی سریع
| مشکل | کار |
|---|---|
| سایت باز نمی‌شود | `tikootak status`؛ DNS (خاکستری بودن ابر)؛ پورت ۸۰/۴۴۳ در گروه امنیتی |
| HTTPS نمی‌آید | `tikootak logs caddy`؛ مطمئن شو رکورد A درست است |
| تماس صدا ندارد | پورت‌های UDP و `PUBLIC_IP` در `.env` |
| build شکست خورد | آینهٔ npm: `--npm` یا `tikootak mirrors set` |
