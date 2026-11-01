port: 7880
log_level: info

rtc:
  tcp_port: 7881
  udp_port: 7882
  # IP عمومی سرور؛ بدون STUN خارجی (روی شبکه ملی STUN گوگل در دسترس نیست)
  node_ip: ${PUBLIC_IP}
  use_external_ip: false

# TURN داخلی LiveKit برای کاربرانی که پشت NAT سخت‌اند
turn:
  enabled: true
  domain: ${DOMAIN}
  udp_port: 3478
  # بازه پورت‌های relay: این بازه باید در فایروال سرور و در docker-compose باز باشد
  relay_range_start: 30000
  relay_range_end: 30100

keys:
  ${LIVEKIT_KEY}: ${LIVEKIT_SECRET}
