#!/usr/bin/env bash
# تست دستی S3 (روی لوکال/تست): فهرست سفید IP و لاگ حسابرسی. GW=http://localhost:3000 KEY=adminkey
GW=${GW:-http://localhost:3000}; KEY=${KEY:-adminkey}
c(){ curl -s -o /dev/null -w "%{http_code} " -H "x-admin-key: $KEY" -H "x-forwarded-for: $1" "$GW/api/admin/stats"; }
echo "انتظار با ADMIN_ALLOW_IPS=203.0.113.0/24: 404 200 404"; c 8.8.8.8; c 203.0.113.50; c 198.51.100.8; echo
