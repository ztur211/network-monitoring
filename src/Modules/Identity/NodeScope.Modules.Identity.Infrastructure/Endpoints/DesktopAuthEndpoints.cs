using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodeScope.Modules.Identity.Infrastructure.Auth;
using NodeScope.Modules.Identity.Infrastructure.Persistence;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Endpoints;

/// <summary>
/// <c>/api/v1/desktop-auth</c> (Node's <c>desktop-auth.controller.ts</c>): the system-browser
/// PKCE flow (S256) that turns a web session into a desktop Bearer token. One-time codes live
/// in <see cref="DesktopAuthCodeStore"/> - in-process rather than Redis, settled by Decision 8
/// (single-node appliance) exactly like the agent lastSeenAt throttle.
/// </summary>
internal static class DesktopAuthEndpoints
{
    private const string AllowedRedirectUri = "nodescope://auth/callback";

    public static void Map(IEndpointRouteBuilder app)
    {
        // authorize and token are public (the code + PKCE verifier are the credential);
        // revoke requires the session it revokes.
        app.MapGet("/api/v1/desktop-auth/authorize", AuthorizeAsync);
        app.MapPost("/api/v1/desktop-auth/token", ExchangeAsync);
        app.MapPost("/api/v1/desktop-auth/revoke", RevokeAsync).RequireAuthorization();
    }

    private static async Task<IResult> AuthorizeAsync(
        HttpContext http,
        IdentityDbContext db,
        DesktopAuthCodeStore store,
        DesktopAuthUrls urls,
        IOptionsMonitor<SessionAuthenticationOptions> auth,
        CancellationToken cancellationToken)
    {
        var query = http.Request.Query;
        var challenge = query["code_challenge"].ToString();
        var state = query["state"].ToString();
        if (query["redirect_uri"].ToString() != AllowedRedirectUri)
        {
            throw new ApiException("DAUTH_001", "INVALID_REDIRECT_URI", 400);
        }

        var now = DateTime.UtcNow;
        var token = SessionTokenCodec.Extract(http.Request, auth.Get(SessionAuthenticationDefaults.SchemeName).Secret);
        var signedIn = token is not null
            && await db.Sessions.AnyAsync(row => row.Token == token && row.ExpiresAt > now, cancellationToken);
        if (!signedIn)
        {
            // Bounce through the web login; returnTo is the FULL authorize URL so the login
            // page can resume the flow (the query is re-encoded inside the parameter).
            var original = urls.ServerUrl + http.Request.Path + http.Request.QueryString;
            return Results.Redirect($"{urls.FrontendUrl}/login?returnTo={Uri.EscapeDataString(original)}");
        }

        var code = store.Issue(token!, challenge, now);
        return Results.Redirect(
            $"{AllowedRedirectUri}?code={Uri.EscapeDataString(code)}&state={Uri.EscapeDataString(state)}");
    }

    private static IResult ExchangeAsync(ExchangeCodeRequestBody body, DesktopAuthCodeStore store)
    {
        var details = new List<string>();
        ValidateRequired(body.Code, "code", details);
        ValidateRequired(body.CodeVerifier, "code_verifier", details);
        if (details.Count > 0)
        {
            throw ApiErrors.Validation(details);
        }

        // Taking the code BEFORE verifying burns it on a wrong verifier: one guess per code.
        var entry = store.Take(body.Code!, DateTime.UtcNow);
        if (entry is null)
        {
            throw new ApiException("DAUTH_002", "CODE_INVALID_OR_EXPIRED", 400);
        }

        var expected = Base64Url(SHA256.HashData(Encoding.UTF8.GetBytes(body.CodeVerifier!)));
        if (!FixedTimeEquals(expected, entry.Challenge))
        {
            throw new ApiException("DAUTH_003", "PKCE_VERIFICATION_FAILED", 400);
        }

        return ApiEnvelope.Created(new DesktopTokenPayload(entry.SessionToken));
    }

    private static async Task<IResult> RevokeAsync(
        HttpContext http,
        IdentityDbContext db,
        IOptionsMonitor<SessionAuthenticationOptions> auth,
        CancellationToken cancellationToken)
    {
        // The route requires authorization, so a token is present and valid here; deleting
        // the Session row is Node's auth.api.signOut without the (discarded) cookie clearing.
        var token = SessionTokenCodec.Extract(http.Request, auth.Get(SessionAuthenticationDefaults.SchemeName).Secret);
        if (token is not null)
        {
            await db.Sessions.Where(row => row.Token == token).ExecuteDeleteAsync(cancellationToken);
        }

        return Results.NoContent();
    }

    private static void ValidateRequired(string? value, string field, List<string> details)
    {
        if (value is null)
        {
            details.Add($"{field} must be a string");
        }

        if (string.IsNullOrEmpty(value))
        {
            details.Add($"{field} should not be empty");
        }
    }

    private static string Base64Url(byte[] value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static bool FixedTimeEquals(string left, string right) =>
        left.Length == right.Length
        && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(left), Encoding.UTF8.GetBytes(right));
}

/// <summary>The exchange request; <c>code_verifier</c> keeps its snake_case wire name.</summary>
internal sealed record ExchangeCodeRequestBody(
    string? Code,
    [property: JsonPropertyName("code_verifier")] string? CodeVerifier);

internal sealed record DesktopTokenPayload(string Token);

/// <summary>The two absolute URLs the authorize redirects are built from.</summary>
internal sealed record DesktopAuthUrls(string FrontendUrl, string ServerUrl);

/// <summary>
/// One-time desktop-auth codes: 32 random bytes base64url, 120-second TTL, single use.
/// <see cref="ConcurrentDictionary{TKey,TValue}.TryRemove(TKey, out TValue)"/> makes
/// take-then-verify atomic, which is what enforces one PKCE guess per code.
/// </summary>
internal sealed class DesktopAuthCodeStore
{
    private static readonly TimeSpan CodeTtl = TimeSpan.FromSeconds(120);

    private readonly ConcurrentDictionary<string, DesktopAuthCode> _codes = new(StringComparer.Ordinal);

    public string Issue(string sessionToken, string challenge, DateTime now)
    {
        // Opportunistic sweep: authorize traffic is interactive-scale, so a scan is cheap
        // and keeps abandoned codes from accumulating without a timer to dispose.
        foreach (var stale in _codes.Where(pair => pair.Value.ExpiresAt <= now))
        {
            _codes.TryRemove(stale.Key, out _);
        }

        var code = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
        _codes[code] = new DesktopAuthCode(sessionToken, challenge, now + CodeTtl);
        return code;
    }

    public DesktopAuthCode? Take(string code, DateTime now) =>
        _codes.TryRemove(code, out var entry) && entry.ExpiresAt > now ? entry : null;
}

internal sealed record DesktopAuthCode(string SessionToken, string Challenge, DateTime ExpiresAt);
