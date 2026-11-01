import { tr } from './i18n.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { feedList, feedForYou, feedInterests, peopleSuggest, roomsSuggest, feedTrendingTags } from './api.js';
import { Icon } from './icons.jsx';
import { PostGrid, ReelsViewer } from './Feed.jsx';
import { PersonRow } from './Profile.jsx';
import { RoomSuggestList } from './Suggest.jsx';
const TAG = /#[\p{L}\p{N}_]{2,30}/gu;

// تب اکسپلور: جستجوی آدم و پست، هشتگ‌های داغ، شبکه‌ی پست‌ها. با زدن روی هر پست، ریلز تمام‌صفحه از همان‌جا شروع می‌شود.
export default function Explore({
  token,
  me,
  client,
  initialQ = '',
  onProfile,
  onRoomJoined
}) {
  const [q, setQ] = useState(initialQ);
  const [posts, setPosts] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState(null);
  const [peopleIdx, setPeopleIdx] = useState(0);
  const [rooms, setRooms] = useState([]);
  const [roomBusy, setRoomBusy] = useState(false);
  const [view, setView] = useState(null); // شماره پستی که ریلز از آن شروع می‌شود
  const [interests, setInterests] = useState(null);
  const [trending, setTrending] = useState([]);
  const loadedRef = useRef([]);
  const gen = useRef(0);

  useEffect(() => {
    feedInterests(token).then(setInterests).catch(() => {});
    feedTrendingTags(token).then(d => setTrending(d.tags || [])).catch(() => {});
  }, [token]);
  useEffect(() => {
    loadedRef.current = (posts || []).map(p => p.id);
  }, [posts]);

  const load = useCallback(async (text, before) => {
    const g = before ? gen.current : ++gen.current;
    setBusy(true);
    try {
      const d = text
        ? await feedList(token, {
          q: text,
          before,
          limit: 24
        })
        : await feedForYou(token, {
          exclude: loadedRef.current,
          limit: 24
        });
      if (g !== gen.current) return;
      setPosts(cur => before ? [...(cur || []), ...d.posts] : d.posts);
      setMore(d.posts.length >= 24);
    } catch {
      if (g === gen.current) setPosts(c => c || []);
    }
    if (g === gen.current) setBusy(false);
  }, [token]);
  useEffect(() => {
    const t = setTimeout(() => {
      setPosts(null);
      load(q.trim());
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, load]);
  useEffect(() => {
    const text = q.trim().replace(/^[#@]/, '');
    if (text.length < 1) {
      setPeople(null);
      return undefined;
    }
    let dead = false;
    const t = setTimeout(() => {
      peopleSuggest(token, text).then(d => {
        if (!dead) setPeople(d.users || []);
      }).catch(() => {
        if (!dead) setPeople([]);
      });
    }, 200);
    return () => { dead = true; clearTimeout(t); };
  }, [q, token]);
  useEffect(() => { setPeopleIdx(0); }, [q]);
  function onSearchKey(e) {
    if (!people?.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setPeopleIdx(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + people.length) % people.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onProfile(people[Math.min(peopleIdx, people.length - 1)].user_id);
    }
  }
  useEffect(() => {
    const text = q.trim().replace(/^[#@]/, '');
    if (text.length < 1) {
      setRooms([]);
      return undefined;
    }
    let dead = false;
    const t = setTimeout(() => {
      roomsSuggest(token, text, 8).then(d => {
        if (!dead) setRooms(d.rooms || []);
      }).catch(() => {
        if (!dead) setRooms([]);
      });
    }, 200);
    return () => { dead = true; clearTimeout(t); };
  }, [q, token]);
  async function joinRoom(room) {
    if (!client) return;
    setRoomBusy(true);
    try {
      const r = await client.joinRoom(room.alias || room.room_id);
      onRoomJoined?.(r.roomId);
    } catch { /* خطای پیوستن در UI عمومی */ }
    setRoomBusy(false);
  }
  const tags = useMemo(() => {
    if (q || !posts) return [];
    const c = new Map();
    for (const p of posts) for (const t of new Set((p.caption || '').match(TAG) || [])) c.set(t, (c.get(t) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([t]) => t);
  }, [posts, q]);
  const tagChips = useMemo(() => {
    const fromInterest = (interests?.tags || []).map(t => `#${t.tag}`);
    const fromTrend = trending.map(t => `#${t.tag}`);
    return [...new Set([...fromInterest, ...fromTrend, ...tags])].slice(0, 14);
  }, [interests, trending, tags]);
  const loadMore = useCallback(() => {
    if (!posts?.length) return;
    if (!q.trim()) return load('', true);
    load(q.trim(), `${posts[posts.length - 1].created_at}_${posts[posts.length - 1].id}`);
  }, [posts, q, load]);
  return <div className="feed explore">
      <header className="chat-head">
        <div className="searchbox grow">
          <Icon n="search" size={18} />
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder={tr("جستجوی آدم‌ها، پست‌ها و #هشتگ")} aria-label={tr("جستجو")} dir="auto" autoComplete="off" />
          {q && <button className="plainbtn" onClick={() => setQ('')} aria-label={tr("پاک کردن")}><Icon n="close" size={18} /></button>}
        </div>
      </header>
      <div className="feed-list prof-list">
        {tagChips.length > 0 && <div className="tags" aria-label={tr("علاقه‌مندی‌های تو")}>
            {tagChips.map(t => <button key={t} className="chip-btn" onClick={() => setQ(t)}>{t}</button>)}
          </div>}
        {people?.length > 0 && <ul className="plain people-res ex-people">
            {people.map(u => <PersonRow key={u.user_id} u={u} onClick={() => onProfile(u.user_id)} />)}
          </ul>}
        {rooms?.length > 0 && <section className="explore-rooms">
            <h4>{tr('کانال‌ها و گروه‌های عمومی')}</h4>
            <RoomSuggestList rooms={rooms} busy={roomBusy} onJoin={joinRoom} testid="explore-room-suggest" />
          </section>}
        {posts === null && <p className="muted pad">…</p>}
        {posts?.length === 0 && <p className="empty-chat">{q ? tr("پستی پیدا نشد.") : tr("چند پست را ببین تا پیشنهادهایت شخصی شود.")}</p>}
        {posts?.length > 0 && <PostGrid posts={posts} onOpen={p => setView(posts.findIndex(x => x.id === p.id))} />}
        {more && <button className="older" disabled={busy} onClick={loadMore}>{busy ? tr("صبر کن…") : tr("بیشتر")}</button>}
      </div>
      {view !== null && posts && <ReelsViewer token={token} me={me} posts={posts} start={view} more={more} busy={busy} loadMore={loadMore} onClose={() => setView(null)} onProfile={onProfile} />}
    </div>;
}