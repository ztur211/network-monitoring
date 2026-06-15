import { useEffect, useState } from 'react';
export default function App() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    window.nodescope.auth.getToken().then((t) => setAuthed(!!t));
    return window.nodescope.auth.onAuthChanged(setAuthed);
  }, []);
  return authed
    ? <div>Signed in</div>
    : <button onClick={() => window.nodescope.auth.login()}>Sign in</button>;
}
