export function Login() {
  return <button onClick={() => window.nodescope.auth.login()}>Sign in</button>;
}
