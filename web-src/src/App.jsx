import { useState } from 'react';
import { loadSession, saveSession, clearSession } from './session.js';
import Auth from './Auth.jsx';
import Shell from './Shell.jsx';
import Onboarding, { seenOnboarding } from './Onboarding.jsx';

export default function App() {
  const [session, setSession] = useState(loadSession);
  const [onb, setOnb] = useState(() => !loadSession() && !seenOnboarding());

  if (!session && onb) return <Onboarding onDone={() => setOnb(false)} />;

  if (!session) {
    return <Auth onAuthed={(s) => { saveSession(s); setSession(s); }} />;
  }
  return (
    <Shell
      key={session.access_token}
      session={session}
      onLogout={() => { clearSession(); setSession(null); }}
    />
  );
}
