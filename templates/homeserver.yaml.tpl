# Synapse: پلتفرم بسته، بدون federation، ثبت‌نام فقط از طریق Gateway
server_name: "${DOMAIN}"
public_baseurl: "https://${DOMAIN}/"
pid_file: /data/homeserver.pid

listeners:
  - port: 8008
    tls: false
    type: http
    x_forwarded: true
    resources:
      - names: [client]
        compress: false

database:
  name: psycopg2
  args:
    user: synapse
    password: "${POSTGRES_PASSWORD}"
    database: synapse
    host: postgres
    cp_min: 5
    cp_max: 10

log_config: "/data/${DOMAIN}.log.config"
media_store_path: /data/media_store
signing_key_path: "/data/${DOMAIN}.signing.key"
max_upload_size: 100M

# سرور ضعیف: کش کمتر، حضور غیرفعال و نگهداری ۶۰ روزه رسانه محلی
# هشدار: با این تنظیم، رسانه‌های چت قدیمی‌تر از ۶۰ روز پاک می‌شوند (در Settings/README هم توضیح داده شده).
caches:
  global_factor: 0.5
presence:
  enabled: false
media_retention:
  local_media_lifetime: 60d
  remote_media_lifetime: 14d

report_stats: false
suppress_key_server_warning: true
trusted_key_servers: []

# بدون federation: فقط کاربران همین سرور
federation_domain_whitelist: []
# فهرست اتاق‌های عمومی فقط برای کاربران واردشده و بدون federation
allow_public_rooms_without_auth: false
allow_public_rooms_over_federation: false
# کاربران واردشده می‌توانند اتاق عمومی بسازند/منتشر کنند (برای کشف گروه/کانال)
room_list_publication_rules:
  - action: allow
    user_id: "*"
    room_id: "*"
    alias: "*"

# ثبت‌نام عمومی بسته؛ Gateway با shared secret کاربر می‌سازه
enable_registration: false
registration_shared_secret: "${SYNAPSE_SHARED_SECRET}"
macaroon_secret_key: "${SYNAPSE_MACAROON_SECRET}"
form_secret: "${SYNAPSE_FORM_SECRET}"
allow_guest_access: false

# چون سرور ممکنه از اینترنت جهانی جدا بشه، به سرویس بیرونی وابسته نباش
url_preview_enabled: false

# لاگ حداقلی برای حفظ حریم خصوصی
user_ips_max_age: 7d
redaction_retention_period: 7d

# ---- سخت‌کردن ورود (S4) ----
password_config:
  enabled: true
  policy:
    enabled: true
    minimum_length: 10
# توجه: محدودیت «address» عمداً نیست؛ ورودها از gateway می‌آیند و همه از یک آدرس داخلی دیده می‌شوند
rc_login:
  account:
    per_second: 0.2
    burst_count: 8
  failed_attempts:
    per_second: 0.1
    burst_count: 6
