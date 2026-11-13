# تیکوتاک کنار VPN و haproxy روی یک سرور

وقتی haproxy پورت ۴۴۳ را گرفته (برای VPN/تانل)، نصب عادی عمداً **متوقف می‌شود** و به سرویس تو دست نمی‌زند.
راه درست: haproxy همان ۴۴۳ را نگه می‌دارد و فقط ترافیک **دامنهٔ تیکوتاک** را (بر اساس نام دامنه، SNI) به Caddy می‌دهد. بقیه مثل قبل به VPN می‌روند.
TLS را haproxy باز نمی‌کند (فقط عبور می‌دهد)، پس گواهی HTTPS و تماس‌ها درست کار می‌کنند.

```
اینترنت → haproxy :443 ─┬─ tikootak.ir → Caddy (127.0.0.1:8443) → تیکوتاک
                         └─ بقیه        → VPN (مثل الان)
```
پورت‌های FRP (مثل 10555 و 10666) و پنل VPN تغییر نمی‌کنند؛ تیکوتاک از آن‌ها استفاده نمی‌کند.

## پیش‌نیاز
- رکورد A دامنه روی IP همین سرور (ابر آروان **خاکستری**).
- فایروال ابری باز: `80/tcp` (اگر آزاد است)، `7881/tcp`، `7882/udp`، `3478/udp`، `30000-30100/udp` (برای تماس). ۴۴۳ همین حالا باز است.
- این پورت‌ها نباید دست برنامهٔ دیگری باشند: `ss -ltnup | grep -E ':(7881|7882|3478) '` (باید خالی باشد).
- بکاپ haproxy: `cp /etc/haproxy/haproxy.cfg /root/haproxy.cfg.bak`

## ۱) نصب (به سرور یا VPN دست نمی‌زند)
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/amirebi9156/tikootak/main/install.sh) --behind-haproxy
```
(با کیت آفلاین هم همین گزینه را به `bootstrap.sh` بده: `sudo ./scripts/bootstrap.sh --domain tikootak.ir --behind-haproxy`.)
فایروال و fail2ban نصب **نمی‌شوند** (فقط با `--harden`).
Caddy روی `127.0.0.1:8443` می‌نشیند (از بیرون دیده نمی‌شود) و PROXY protocol روشن است تا IP واقعی کاربران به برنامه برسد.

## ۲) اضافه‌کردن تیکوتاک به haproxy (دستی؛ ۲ تکه)
```bash
sudo tikootak haproxy snippet
```
همان متن را اعمال کن: یک خط `use_backend` در frontend پورت ۴۴۳ (بالای `default_backend` خودت) و یک بلاک `backend bk_tikootak`. بعد:
```bash
haproxy -c -f /etc/haproxy/haproxy.cfg && systemctl reload haproxy     # reload، نه restart؛ اتصال VPN قطع نمی‌شود
sudo tikootak haproxy test
```

## اگر کار نکرد
| مشکل | کار |
|---|---|
| frontend تو `mode http` است (خود haproxy TLS باز می‌کند) | این روش جواب نمی‌دهد؛ بخش frontend/backend کانفیگ (بدون رمز) را بفرست تا نسخهٔ مناسب بدهم |
| haproxy داخل Docker است | `127.0.0.1` به میزبان نمی‌رسد؛ به‌جایش IP میزبان را در `server caddy ...` بگذار |
| `haproxy test` می‌گوید Caddy مستقیم جواب می‌دهد ولی از haproxy نه | قاعدهٔ `use_backend` یا `tcp-request inspect-delay` در frontend درست نیست |
| گواهی نمی‌آید | `docker compose logs --tail 50 caddy`؛ Caddy گواهی را از طریق همین مسیر ۴۴۳ می‌گیرد؛ در قطعی اینترنت `sudo tikootak cert howto` |
| برگرداندن | `sudo tikootak haproxy disable` و حذف دو تکهٔ بالا از haproxy.cfg + reload |

وضعیت: `sudo tikootak haproxy status`.
