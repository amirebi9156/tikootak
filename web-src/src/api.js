import { tr } from './i18n.js';
// ارتباط با Gateway (ثبت‌نام، ورود، توکن تماس). همه درخواست‌ها به همین دامنه می‌رن، پس CORS و CDN لازم نیست.
async function call(path, {
  method = 'GET',
  body,
  token
} = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw Object.assign(new Error('network'), {
      code: 'network'
    });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {/* بدنه خالی */}
  if (!res.ok) {
    throw Object.assign(new Error(data?.error || `http_${res.status}`), {
      code: data?.error || `http_${res.status}`,
      status: res.status
    });
  }
  return data;
}
export const register = (invite, username, password, displayname) => call('/api/auth/register', {
  method: 'POST',
  body: {
    invite,
    username,
    password,
    displayname
  }
});
export const login = (username, password) => call('/api/auth/login', {
  method: 'POST',
  body: {
    username,
    password
  }
});
export const rtcToken = (token, roomId) => call('/api/rtc/token', {
  method: 'POST',
  body: {
    room_id: roomId
  },
  token
});
const MESSAGES = {
  registration_closed: tr("ثبت‌نام فعلاً بسته است. بعداً دوباره سر بزن."),
  invite_too_new: tr("حساب‌های تازه تا ۲۴ ساعت نمی‌توانند کد دعوت بسازند."),
  invite_limit: tr("به سقف کدهای فعالت رسیده‌ای. یکی را باطل کن یا منتظر استفاده/انقضای آن‌ها باش."),
  invite_disabled: tr("ساخت کد دعوت فعلاً غیرفعال است."),
  invite_registration_closed: tr("تا وقتی ثبت‌نام بسته است نمی‌شود کد دعوت ساخت."),
  invalid_invite: tr("کد دعوت معتبر نیست، منقضی شده یا ظرفیتش پر شده."),
  username_taken: tr("این نام کاربری قبلاً گرفته شده."),
  invalid_username: tr("نام کاربری باید ۳ تا ۳۲ حرف انگلیسی کوچک، عدد یا نقطه، خط تیره و زیرخط باشد."),
  invalid_password: tr("رمز عبور باید حداقل ۱۰ و حداکثر ۱۲۸ کاراکتر باشد."),
  weak_password: tr("این رمز خیلی ساده یا قابل‌حدس است. یک رمز طولانی‌تر و غیرتکراری انتخاب کن."),
  account_locked: tr("به‌خاطر تلاش‌های ناموفق زیاد، ورود این حساب چند دقیقه قفل شد. بعداً دوباره امتحان کن."),
  too_many_new: tr("حساب تازه‌ات هنوز سقف کمتری دارد. کمی بعد دوباره امتحان کن."),
  duplicate: tr("همین متن را همین الان فرستاده‌ای."),
  login_failed: tr("نام کاربری یا رمز عبور درست نیست."),
  missing_fields: tr("همه فیلدها را پر کن."),
  upstream_unavailable: tr("سرور چت در دسترس نیست. چند لحظه بعد دوباره امتحان کن."),
  register_failed: tr("ساخت حساب انجام نشد. دوباره امتحان کن."),
  network: tr("به سرور وصل نمی‌شوم. اتصال اینترنت یا شبکه را بررسی کن."),
  not_a_member: tr("برای تماس باید عضو این اتاق باشی.")
};
export function errText(e) {
  if (e?.status === 429) return tr("تلاش‌های زیاد. چند دقیقه صبر کن و دوباره امتحان کن.");
  return MESSAGES[e?.code] || tr("مشکلی پیش آمد. دوباره امتحان کن.");
}

// ---------- فید ----------
export const feedList = (token, {
  before,
  user,
  following,
  q: text,
  limit
} = {}) => {
  const q = new URLSearchParams({
    limit: String(limit || 8)
  });
  if (text) q.set('q', text);
  if (before) q.set('before', before);
  if (user) q.set('user', user);
  if (following) q.set('following', '1');
  return call(`/api/feed/posts?${q}`, {
    token
  });
};
export const feedPost = (token, id) => call(`/api/feed/posts/${id}`, {
  token
});
export const shareCreate = (token, kind, id) => call('/api/music/share', {
  method: 'POST',
  body: {
    kind,
    id
  },
  token
});
export const shareGet = (token, code) => call(`/api/music/share/${encodeURIComponent(code)}`, {
  token
});
export const feedLike = (token, id) => call(`/api/feed/posts/${id}/like`, {
  method: 'POST',
  token
});
export const feedDelete = (token, id) => call(`/api/feed/posts/${id}`, {
  method: 'DELETE',
  token
});
export const feedComments = (token, id) => call(`/api/feed/posts/${id}/comments`, {
  token
});
export const feedComment = (token, id, text) => call(`/api/feed/posts/${id}/comments`, {
  method: 'POST',
  body: {
    text
  },
  token
});

// آپلود با نوار پیشرفت (fetch هنوز پیشرفت آپلود نمی‌دهد)
export function feedUpload(token, file, caption, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/feed/posts');
    x.setRequestHeader('authorization', `Bearer ${token}`);
    x.setRequestHeader('content-type', file.type);
    x.setRequestHeader('x-caption', encodeURIComponent(caption));
    x.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    x.onerror = () => reject(Object.assign(new Error('network'), {
      code: 'network'
    }));
    x.onload = () => {
      let d = null;
      try {
        d = JSON.parse(x.responseText);
      } catch {/* ignore */}
      if (x.status === 201 || x.status === 200) resolve(d);else reject(Object.assign(new Error(d?.error || `http_${x.status}`), {
        code: d?.error || `http_${x.status}`,
        max_mb: d?.max_mb
      }));
    };
    x.send(file);
  });
}

// پوستر/تامبنیل ویدیو را به پست می‌چسباند (بدنه خام تصویر کوچک)
export function feedThumb(token, id, blob) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/feed/posts/${encodeURIComponent(id)}/thumb`);
    x.setRequestHeader('authorization', `Bearer ${token}`);
    x.setRequestHeader('content-type', blob.type || 'image/webp');
    x.onerror = () => reject(Object.assign(new Error('network'), { code: 'network' }));
    x.onload = () => {
      let d = null;
      try { d = JSON.parse(x.responseText); } catch { /* ignore */ }
      if (x.status === 201 || x.status === 200) resolve(d);
      else reject(Object.assign(new Error(d?.error || `http_${x.status}`), { code: d?.error || `http_${x.status}` }));
    };
    x.send(blob);
  });
}

// ---------- موزیک ----------
export const musicTracks = token => call('/api/music/tracks', {
  token
});
export const trackPlaylists = (token, id) => call(`/api/music/tracks/${id}/playlists`, {
  token
});
export const musicDeleteTrack = (token, id) => call(`/api/music/tracks/${id}`, {
  method: 'DELETE',
  token
});
export const playlistsList = (token, scope) => call(`/api/music/playlists?scope=${scope}`, {
  token
});
export const playlistGet = (token, id) => call(`/api/music/playlists/${id}`, {
  token
});
export const playlistCreate = (token, name, is_public) => call('/api/music/playlists', {
  method: 'POST',
  body: {
    name,
    is_public
  },
  token
});
export const playlistPatch = (token, id, body) => call(`/api/music/playlists/${id}`, {
  method: 'PATCH',
  body,
  token
});
export const playlistDelete = (token, id) => call(`/api/music/playlists/${id}`, {
  method: 'DELETE',
  token
});
export const playlistAdd = (token, id, track_id) => call(`/api/music/playlists/${id}/tracks`, {
  method: 'POST',
  body: {
    track_id
  },
  token
});
export const playlistRemove = (token, id, track) => call(`/api/music/playlists/${id}/tracks/${track}`, {
  method: 'DELETE',
  token
});
export function musicUpload(token, file, title, artist, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/music/tracks');
    x.setRequestHeader('authorization', `Bearer ${token}`);
    x.setRequestHeader('content-type', file.type);
    x.setRequestHeader('x-title', encodeURIComponent(title));
    x.setRequestHeader('x-artist', encodeURIComponent(artist));
    x.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    x.onerror = () => reject(Object.assign(new Error('network'), {
      code: 'network'
    }));
    x.onload = () => {
      let d = null;
      try {
        d = JSON.parse(x.responseText);
      } catch {/* ignore */}
      if (x.status === 201 || x.status === 200) resolve(d);else reject(Object.assign(new Error(d?.error || `http_${x.status}`), {
        code: d?.error || `http_${x.status}`,
        status: x.status,
        max_mb: d?.max_mb
      }));
    };
    x.send(file);
  });
}

// ---------- پروفایل و افراد ----------
export const profileGet = (token, id) => call(`/api/profiles/${encodeURIComponent(id)}`, {
  token
});
export const profilesLite = (token, ids) => call(`/api/profiles?ids=${ids.map(encodeURIComponent).join(',')}`, {
  token
});
export const profileSetBio = (token, bio) => call('/api/profile', {
  method: 'PUT',
  body: {
    bio
  },
  token
});
export const profileSetPrivate = (token, is_private) => call('/api/profile', {
  method: 'PATCH',
  body: {
    is_private
  },
  token
});
export const profileDelAvatar = token => call('/api/profile/avatar', {
  method: 'DELETE',
  token
});
export const followToggle = (token, id) => call(`/api/follow/${encodeURIComponent(id)}`, {
  method: 'POST',
  token
});
export const followUnfollow = (token, id) => call(`/api/follow/${encodeURIComponent(id)}`, {
  method: 'DELETE',
  token
});
export const followRequests = token => call('/api/follow/requests', {
  token
});
export const followAccept = (token, id) => call(`/api/follow/requests/${encodeURIComponent(id)}/accept`, {
  method: 'POST',
  token
});
export const followDecline = (token, id) => call(`/api/follow/requests/${encodeURIComponent(id)}/decline`, {
  method: 'POST',
  token
});
export const removeFollower = (token, id) => call(`/api/followers/${encodeURIComponent(id)}`, {
  method: 'DELETE',
  token
});
export const followList = (token, id, kind) => call(`/api/profiles/${encodeURIComponent(id)}/follows?kind=${kind}`, {
  token
});
export const privacyGet = token => call('/api/privacy', {
  token
});
export const privacySet = (token, body) => call('/api/privacy', {
  method: 'PUT',
  body,
  token
});
export const searchUsers = (token, q) => call(`/api/users/search?q=${encodeURIComponent(q)}`, {
  token
});
export const peopleSuggest = (token, q) => call(`/api/people/suggest?q=${encodeURIComponent(q)}`, {
  token
});
export const roomsSuggest = (token, q, limit = 8) => call(`/api/rooms/suggest?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`, {
  token
});
export const commentLike = (token, id) => call(`/api/feed/comments/${id}/like`, {
  method: 'POST',
  token
});
export const commentDelete = (token, id) => call(`/api/feed/comments/${id}`, {
  method: 'DELETE',
  token
});
export async function profileSetAvatar(token, blob) {
  const res = await fetch('/api/profile/avatar', {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': blob.type
    },
    body: blob
  });
  if (!res.ok) throw new Error('avatar_failed');
  return res.json();
}
export async function musicSetCover(token, id, blob) {
  const res = await fetch(`/api/music/tracks/${id}/cover`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': blob.type
    },
    body: blob
  });
  if (!res.ok) throw new Error('cover_failed');
  return res.json();
}

// ---------- استوری ----------
export const storiesList = token => call('/api/stories', {
  token
});
export const storyView = (token, id) => call(`/api/stories/${id}/view`, {
  method: 'POST',
  token
});
export const storyViews = (token, id) => call(`/api/stories/${id}/views`, {
  token
});
export const storyDelete = (token, id) => call(`/api/stories/${id}`, {
  method: 'DELETE',
  token
});
export function storyUpload(token, file, caption, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/stories');
    x.setRequestHeader('authorization', `Bearer ${token}`);
    x.setRequestHeader('content-type', file.type);
    x.setRequestHeader('x-caption', encodeURIComponent(caption));
    x.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    x.onerror = () => reject(Object.assign(new Error('network'), {
      code: 'network'
    }));
    x.onload = () => {
      let d = null;
      try {
        d = JSON.parse(x.responseText);
      } catch {/* ignore */}
      if (x.status === 201 || x.status === 200) resolve(d);else reject(Object.assign(new Error(d?.error || `http_${x.status}`), {
        code: d?.error || `http_${x.status}`,
        max_mb: d?.max_mb
      }));
    };
    x.send(file);
  });
}
// ---------- اعلان‌ها ----------
export const notificationsList = (token, before) =>
  call(`/api/notifications${before ? `?before=${encodeURIComponent(before)}` : ''}`, {
    token
  });
export const notificationsUnread = token => call('/api/notifications/unread', {
  token
});
export const notificationsRead = (token, ids) => call('/api/notifications/read', {
  method: 'POST',
  body: ids ? {
    ids
  } : {
    all: true
  },
  token
});
export const notificationsClear = token => call('/api/notifications', {
  method: 'DELETE',
  token
});

// ---------- فید هوشمند و بلاک ----------
export const feedForYou = (token, { exclude, limit } = {}) => {
  const q = new URLSearchParams({ limit: String(limit || 20) });
  if (exclude?.length) q.set('exclude', exclude.slice(0, 100).join(','));
  return call(`/api/feed/for-you?${q}`, { token });
};
export const feedViews = (token, events) => call('/api/feed/views', { method: 'POST', body: { events }, token });
export const feedSeen = (token, ids) => call('/api/feed/seen', { method: 'POST', body: { ids }, token });
export const feedNotInterested = (token, id) => call(`/api/feed/posts/${id}/not-interested`, { method: 'POST', token });
export const feedShare = (token, id) => call(`/api/feed/posts/${id}/share`, { method: 'POST', token });
export const feedInterests = token => call('/api/feed/interests', { token });
export const blocksList = token => call('/api/blocks', { token });
export const blockUser = (token, id) => call(`/api/blocks/${encodeURIComponent(id)}`, { method: 'POST', token });
export const unblockUser = (token, id) => call(`/api/blocks/${encodeURIComponent(id)}`, { method: 'DELETE', token });
export const reportCreate = (token, kind, id, reason, note) => call('/api/reports', { method: 'POST', body: { kind, id, reason, note }, token });

export const feedTrendingTags = token => call('/api/feed/tags/trending', { token });

export const publicConfig = () => call('/api/public/config');
export const invitesMine = token => call('/api/invites', { token });
export const inviteCreate = token => call('/api/invites', { method: 'POST', token });
export const inviteRevoke = (token, code) => call(`/api/invites/${encodeURIComponent(code)}`, { method: 'DELETE', token });

// سیاست آپلود برای کاربر جاری: { small_kb, allowed: { image, video, voice, music, file } }
let _upPol = { at: 0, v: null };
export async function uploadPolicy(token, force = false) {
  if (!force && _upPol.v && Date.now() - _upPol.at < 60_000) return _upPol.v;
  try {
    const v = await call('/api/uploads/policy', { token });
    _upPol = { at: Date.now(), v };
    return v;
  } catch { return _upPol.v; }
}
