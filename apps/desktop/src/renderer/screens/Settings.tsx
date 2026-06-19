import { useEffect, useState } from 'react';

export function Settings() {
  const [apiUrl, setApiUrl] = useState('');

  useEffect(() => {
    window.nodescope.app.getConfig().then((c) => setApiUrl(c.apiUrl));
  }, []);

  return (
    <section aria-label="settings">
      <h1>Settings</h1>
      <input aria-label="API URL" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
      <button onClick={() => window.nodescope.app.setApiUrl(apiUrl)}>Save</button>
      <p>Restart to apply.</p>
    </section>
  );
}
