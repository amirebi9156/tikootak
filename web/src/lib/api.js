// ارتباط با Gateway (ثبت‌نام، ورود، توکن تماس). همه درخواست‌ها هم‌دامنه‌اند و
// از طریق Caddy به سرویس gateway می‌رسند.

export class ApiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function post(path, body, token) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error || (res.status === 429 ? 'rate_limited' : 'unknown'));
  }
  return data;
}

export const register = ({ invite, username, password, displayname }) =>
  post('/api/auth/register', { invite, username, password, displayname });

export const login = ({ username, password }) =>
  post('/api/auth/login', { username, password });

export const rtcToken = (accessToken, roomId) =>
  post('/api/rtc/token', { room_id: roomId }, accessToken);

// پیام خطا به فارسی
const MESSAGES = {
  network: 'ارتباط با سرور برقرار نشد. اینترنت یا شبکه‌ات را بررسی کن.',
  rate_limited: 'تعداد تلاش‌ها زیاد بود. چند دقیقه بعد دوباره امتحان کن.',
  invalid_username: 'نام کاربری باید ۳ تا ۳۲ حرف انگلیسی کوچک، عدد، نقطه یا خط تیره باشد.',
  invalid_password: 'رمز عبور باید حداقل ۸ حرف باشد.',
  invalid_invite: 'کد دعوت معتبر نیست، منقضی شده یا ظرفیتش پر شده.',
  username_taken: 'این نام کاربری قبلاً گرفته شده.',
  login_failed: 'نام کاربری یا رمز عبور درست نیست.',
  register_failed: 'ساخت حساب انجام نشد. کمی بعد دوباره تلاش کن.',
  upstream_unavailable: 'سرور چت در دسترس نیست. کمی بعد دوباره تلاش کن.',
  not_a_member: 'فقط اعضای این گروه می‌توانند وارد تماس شوند.',
  unauthorized: 'نشستت منقضی شده. دوباره وارد شو.',
  missing_fields: 'همه فیلدها را پر کن.',
  unknown: 'مشکلی پیش آمد. دوباره تلاش کن.',
};

export const errorText = (code) => MESSAGES[code] || MESSAGES.unknown;
