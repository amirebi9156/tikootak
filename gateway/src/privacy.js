// قانون مرکزی دید محتوا (Q1). همهٔ مسیرهای محتوا باید از همین توابع استفاده کنند.
// ترتیب اولویت: مالک ↔ بلاک ↔ بن ↔ حساب خصوصی/دنبال‌کردن.
// پاسخ غیرمجاز در APIها ۴۰۴ است (نه ۴۰۳) تا وجود محتوا لو نرود.
export function createPrivacy({ db }) {
  const exists = db.prepare('SELECT 1 FROM registrations WHERE user_id=?');
  const privateStmt = db.prepare('SELECT is_private FROM profiles WHERE user_id=?');
  const followStmt = db.prepare('SELECT status FROM follows WHERE follower=? AND followee=?');
  const blockStmt = db.prepare(
    'SELECT 1 FROM blocks WHERE (blocker=? AND blocked=?) OR (blocker=? AND blocked=?)',
  );
  const banStmt = db.prepare('SELECT 1 FROM bans WHERE user_id=?');

  const isPrivate = (uid) => !!privateStmt.get(uid)?.is_private;
  const followStatus = (viewer, owner) => followStmt.get(viewer, owner)?.status || 'none';
  const isBlocked = (a, b) => !!blockStmt.get(a, b, b, a);
  const isBanned = (uid) => !!banStmt.get(uid);

  // تنها منبع حقیقت برای دیدن پست/پروفایل/رسانه/لیست‌ها.
  function canView(viewer, owner) {
    if (!viewer || !owner) return false;
    if (isBanned(viewer)) return false;
    if (viewer === owner) return true;
    if (!exists.get(owner)) return false;
    if (isBanned(owner)) return false;
    if (isBlocked(viewer, owner)) return false;
    if (!isPrivate(owner)) return true;
    return followStatus(viewer, owner) === 'accepted';
  }

  // استوری علاوه بر canView، مخاطب «فقط دنبال‌کننده‌ها» را هم رعایت می‌کند.
  function canSeeStory(viewer, owner, audience = 'everyone') {
    if (!canView(viewer, owner)) return false;
    if (viewer === owner) return true;
    if (audience === 'followers') return followStatus(viewer, owner) === 'accepted';
    return true;
  }

  // شرط SQL قابل استفاده در لیست‌ها: نویسندهٔ عمومی + خودم + فالوور accepted.
  // باید داخل SQL و قبل از LIMIT باشد؛ وگرنه ردیف‌های خصوصی صفحه را خالی می‌کنند.
  function visibilityClause(ownerExpr, viewer) {
    if (!viewer) return { sql: '0', args: [] };
    return {
      sql: `(${ownerExpr} = ? OR COALESCE((SELECT pv.is_private FROM profiles pv WHERE pv.user_id=${ownerExpr}),0)=0
        OR EXISTS(SELECT 1 FROM follows vf WHERE vf.follower=? AND vf.followee=${ownerExpr} AND vf.status='accepted'))`,
      args: [viewer, viewer],
    };
  }

  return {
    canView,
    canSeeStory,
    visibilityClause,
    isPrivate,
    followStatus,
    isBlocked,
    isBanned,
  };
}
