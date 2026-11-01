import { useEffect, useReducer, useState } from 'react';
import { ClientEvent, RoomEvent, RoomMemberEvent } from 'matrix-js-sdk';
import Auth from './components/Auth.jsx';
import Sidebar from './components/Sidebar.jsx';
import Chat from './components/Chat.jsx';
import Call from './components/Call.jsx';
import Dialog from './components/Dialog.jsx';
import { loadSession, saveSession, clearSession } from './lib/session.js';
import { makeClient } from './lib/matrix.js';
import { localpart } from './lib/format.js';

// هر کدام از این رویدادها یعنی چیزی عوض شده و صفحه باید دوباره کشیده شود
const REDRAW = [
  ClientEvent.Room,
  ClientEvent.DeleteRoom,
  RoomEvent.Timeline,
  RoomEvent.Name,
  RoomEvent.MyMembership,
  RoomEvent.LocalEchoUpdated,
  RoomEvent.Receipt,
  RoomEvent.UnreadNotifications,
  RoomMemberEvent.Membership,
  RoomMemberEvent.Name,
];

function Shell({ session, onLogout }) {
  const [client, setClient] = useState(null);
  const [syncState, setSyncState] = useState('CONNECTING');
  const [activeId, setActiveId] = useState(null);
  const [callRoomId, setCallRoomId] = useState(null);
  const [dialog, setDialog] = useState(null); // { mode: 'create' } | { mode: 'invite', roomId }
  const [, redraw] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    const c = makeClient(session);
    let raf = 0;
    const bump = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; redraw(); });
    };
    c.on(ClientEvent.Sync, (state, _prev, data) => {
      setSyncState(state);
      if (state === 'ERROR' && data?.error?.errcode === 'M_UNKNOWN_TOKEN') onLogout();
      bump();
    });
    c.on('Session.logged_out', onLogout);
    REDRAW.forEach((e) => c.on(e, bump));
    c.startClient({ initialSyncLimit: 40, lazyLoadMembers: true });
    setClient(c);
    return () => {
      cancelAnimationFrame(raf);
      c.stopClient();
      c.removeAllListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (!client) return null;

  const ready = syncState === 'PREPARED' || syncState === 'SYNCING';
  const all = client.getRooms();
  const rooms = all
    .filter((r) => r.getMyMembership() === 'join')
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
  const invites = all.filter((r) => r.getMyMembership() === 'invite');
  const activeRoom = rooms.find((r) => r.roomId === activeId) || null;
  const callRoom = callRoomId ? client.getRoom(callRoomId) : null;
  const myName = client.getUser(session.userId)?.displayName || localpart(session.userId);
  const callNameOf = (userId) => callRoom?.getMember(userId)?.name || localpart(userId);

  async function logout() {
    try { await client.logout(true); } catch { /* حتی اگر سرور جواب نداد از اینجا خارج می‌شویم */ }
    onLogout();
  }

  function announceJoin() {
    client
      .sendMessage(callRoomId, { msgtype: 'm.notice', body: `${myName} وارد تماس گروهی شد` })
      .catch(() => {});
  }

  const dialogRoom = dialog?.mode === 'invite' ? client.getRoom(dialog.roomId) : null;

  return (
    <div className="shell" data-view={activeRoom ? 'chat' : 'list'}>
      <Sidebar
        client={client}
        rooms={rooms}
        invites={invites}
        activeId={activeId}
        ready={ready}
        myName={myName}
        callRoom={callRoom && callRoomId !== activeId ? callRoom : null}
        onBackToCall={() => setActiveId(callRoomId)}
        onSelect={setActiveId}
        onNew={() => setDialog({ mode: 'create' })}
        onLogout={logout}
      />

      <main className="main">
        {callRoom && (
          <Call
            key={callRoomId}
            accessToken={session.accessToken}
            roomId={callRoomId}
            roomName={callRoom.name}
            nameOf={callNameOf}
            hidden={callRoomId !== activeId}
            onJoined={announceJoin}
            onLeave={() => setCallRoomId(null)}
          />
        )}

        {callRoom && callRoomId !== activeId && (
          <button className="call-pill in-main" onClick={() => setActiveId(callRoomId)}>
            <span className="live-dot" aria-hidden="true" />
            در تماس: {callRoom.name}. برگرد به تماس
          </button>
        )}

        {activeRoom ? (
          <Chat
            key={activeRoom.roomId}
            client={client}
            room={activeRoom}
            inCall={callRoomId === activeRoom.roomId}
            onBack={() => setActiveId(null)}
            onCall={() => setCallRoomId(activeRoom.roomId)}
            onInvite={() => setDialog({ mode: 'invite', roomId: activeRoom.roomId })}
          />
        ) : (
          <div className="empty-main">
            <div className="breath small" aria-hidden="true">
              <span className="breath-ring r2" />
              <span className="breath-ring r1" />
            </div>
            <p>یک گروه را از فهرست انتخاب کن یا گروه تازه‌ای بساز.</p>
          </div>
        )}
      </main>

      {dialog && (
        <Dialog
          client={client}
          mode={dialog.mode}
          room={dialogRoom}
          onClose={() => setDialog(null)}
          onCreated={(id) => { setDialog(null); setActiveId(id); }}
        />
      )}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(loadSession);

  const onAuth = (s) => {
    saveSession(s);
    setSession(s);
  };
  const onLogout = () => {
    clearSession();
    setSession(null);
  };

  return session ? <Shell key={session.userId + session.deviceId} session={session} onLogout={onLogout} /> : <Auth onAuth={onAuth} />;
}
