using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace NodeScope.Modules.Identity.Infrastructure.Endpoints;

/// <summary>
/// The appliance's browser-facing auth page, served by the host itself since step 6
/// removed the web SPA. Its one production caller is the desktop-auth flow:
/// <c>/api/v1/desktop-auth/authorize</c> bounces an unauthenticated system browser to
/// <c>/login?returnTo=&lt;authorize URL&gt;</c>, this page signs the user in (or up) against
/// the same-origin auth endpoints, and the resumed authorize hop hands the browser back
/// to the desktop app. Self-contained by construction - inline styles and script, no
/// external assets - because the appliance is the only origin that exists.
/// </summary>
internal static class AuthPagesEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        app.MapGet("/login", ServePage);
        // The appliance's face and the SPA-era /register route both land on the page.
        app.MapGet("/", () => Results.Redirect("/login"));
        app.MapGet("/register", () => Results.Redirect("/login#create"));
    }

    private static IResult ServePage(HttpContext http)
    {
        // no-store: the page is tiny and an auth surface - a cached copy buys nothing.
        http.Response.Headers.CacheControl = "no-store";
        return Results.Content(PageHtml, "text/html; charset=utf-8");
    }

    /// <summary>
    /// The whole page. The returnTo validation mirrors the retired web client's
    /// safeDesktopReturnTo: an absolute URL, same origin as this page, whose path is the
    /// desktop-auth authorize endpoint - anything else (javascript:, protocol-relative,
    /// cross-origin, bare paths) is dropped, never followed.
    /// </summary>
    private const string PageHtml = """
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>NodeScope - Sign in</title>
        <style>
          :root { color-scheme: light dark; }
          * { box-sizing: border-box; margin: 0; }
          body {
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            min-height: 100vh; display: flex; align-items: center; justify-content: center;
            background: #f8fafc; color: #0f172a;
          }
          @media (prefers-color-scheme: dark) {
            body { background: #0f172a; color: #f1f5f9; }
            .card { background: #1e293b; border-color: #334155; }
            input { background: #0f172a; border-color: #475569; color: #f1f5f9; }
            .muted { color: #94a3b8; }
          }
          .card {
            width: 100%; max-width: 360px; margin: 24px;
            background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px;
          }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .muted { font-size: 13px; color: #64748b; margin-bottom: 20px; }
          label { display: block; font-size: 13px; margin: 12px 0 4px; }
          input {
            width: 100%; padding: 10px 12px; font-size: 14px;
            border: 1px solid #cbd5e1; border-radius: 8px; background: #ffffff; color: inherit;
          }
          button {
            width: 100%; margin-top: 18px; padding: 11px; font-size: 15px; font-weight: 600;
            color: #ffffff; background: #2563eb; border: 0; border-radius: 8px; cursor: pointer;
          }
          button:disabled { opacity: 0.6; cursor: default; }
          .switch { margin-top: 16px; font-size: 13px; text-align: center; }
          .switch a { color: #2563eb; cursor: pointer; text-decoration: none; }
          .error {
            display: none; margin-top: 14px; padding: 10px 12px; font-size: 13px;
            border: 1px solid #fecaca; border-radius: 8px; background: rgba(239, 68, 68, 0.08);
            color: #dc2626;
          }
          .done { display: none; text-align: center; }
          .done h1 { margin-bottom: 8px; }
          .hidden { display: none; }
        </style>
        </head>
        <body>
        <main class="card">
          <div id="forms">
            <h1 id="title">Sign in to NodeScope</h1>
            <p class="muted" id="subtitle">The desktop app sent you here to sign in.</p>
            <form id="auth-form">
              <div id="name-row" class="hidden">
                <label for="name">Name</label>
                <input id="name" name="name" autocomplete="name">
              </div>
              <label for="email">Email</label>
              <input id="email" name="email" type="email" required autocomplete="email">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" required minlength="8"
                     autocomplete="current-password">
              <button id="submit" type="submit">Sign in</button>
            </form>
            <div class="error" id="error"></div>
            <p class="switch" id="switch-line">
              Don't have an account? <a id="switch">Create one</a>
            </p>
          </div>
          <div class="done" id="done">
            <h1>Signed in</h1>
            <p class="muted">You can close this tab and return to the NodeScope desktop app.</p>
          </div>
        </main>
        <script>
        (function () {
          "use strict";
          var creating = location.hash === "#create";
          var form = document.getElementById("auth-form");
          var error = document.getElementById("error");
          var submit = document.getElementById("submit");

          function render() {
            document.getElementById("title").textContent =
              creating ? "Create your NodeScope account" : "Sign in to NodeScope";
            document.getElementById("name-row").className = creating ? "" : "hidden";
            document.getElementById("name").required = creating;
            document.getElementById("password").autocomplete =
              creating ? "new-password" : "current-password";
            submit.textContent = creating ? "Create account" : "Sign in";
            document.getElementById("switch-line").innerHTML = creating
              ? 'Already have an account? <a id="switch">Sign in</a>'
              : 'Don\'t have an account? <a id="switch">Create one</a>';
            document.getElementById("switch").onclick = function () {
              creating = !creating;
              error.style.display = "none";
              render();
            };
          }

          // The retired web client's safeDesktopReturnTo, verbatim in behavior: only a
          // same-origin absolute URL pointing at the authorize endpoint may be followed.
          function safeReturnTo() {
            var raw = new URLSearchParams(location.search).get("returnTo");
            if (!raw) { return null; }
            var url;
            try { url = new URL(raw); } catch { return null; }
            if (url.origin !== location.origin) { return null; }
            if (url.pathname.indexOf("/api/v1/desktop-auth/authorize") !== 0) { return null; }
            return raw;
          }

          form.addEventListener("submit", async function (event) {
            event.preventDefault();
            error.style.display = "none";
            submit.disabled = true;
            try {
              var body = {
                email: document.getElementById("email").value.trim(),
                password: document.getElementById("password").value,
              };
              if (creating) { body.name = document.getElementById("name").value.trim(); }
              var response = await fetch(
                creating ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "same-origin",
                  body: JSON.stringify(body),
                });
              if (!response.ok) {
                var detail = null;
                try { detail = await response.json(); } catch { /* not JSON */ }
                error.textContent = (detail && detail.message) ||
                  (creating ? "Sign up failed." : "Sign in failed. Check your email and password.");
                error.style.display = "block";
                return;
              }
              var returnTo = safeReturnTo();
              if (returnTo) { location.href = returnTo; return; }
              document.getElementById("forms").style.display = "none";
              document.getElementById("done").style.display = "block";
            } catch {
              error.textContent = "Could not reach the appliance. Check the connection and try again.";
              error.style.display = "block";
            } finally {
              submit.disabled = false;
            }
          });

          render();
        })();
        </script>
        </body>
        </html>
        """;
}
