import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/auth-store';
import { Shell } from './shell/Shell';
import { Login } from './screens/Login';
import { Settings } from './screens/Settings';

export default function App() {
  const authed = useAuthStore((s) => s.authed);
  const setAuthed = useAuthStore((s) => s.setAuthed);

  useEffect(() => {
    window.nodescope.auth.getToken().then((t) => setAuthed(!!t));
    return window.nodescope.auth.onAuthChanged(setAuthed);
  }, [setAuthed]);

  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={authed ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/" element={authed ? <Shell /> : <Navigate to="/login" replace />} />
        <Route path="/settings" element={authed ? <Settings /> : <Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  );
}
