using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodeScope.Modules.Identity.Domain;
using NodeScope.Modules.Identity.Infrastructure.Persistence;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Auth;

/// <summary>
/// Decision 7's wire shim for <c>/api/auth/*</c>, replacing the proxied Better Auth handler
/// (better-auth 1.6.23 + bearer plugin). Response bodies, status codes, cookies, and the
/// <c>set-auth-token</c> header were captured from the live Node target on 2026-07-24 and are
/// reproduced verbatim - these routes speak Better Auth's own JSON, NOT the NodeScope
/// envelope. Deleted in step 6 alongside <c>apps/</c>.
/// <para>Deliberate deviations, recorded in the decision log: the <c>session_data</c> cookie
/// cache is not set (Decision 7 sub-decision 1 - it trades a 5-minute revocation window for
/// one indexed read; sign-out still clears it so Node-era cookies die), and password reset
/// writes the <c>Verification</c> row but sends no email (the Node sender is a no-op too).</para>
/// </summary>
internal static partial class BetterAuthEndpoints
{
    private const string SessionDataCookie = "better-auth.session_data";
    private const string DontRememberCookie = "better-auth.dont_remember";
    private const string SetAuthTokenHeader = "set-auth-token";

    private const int MinPasswordLength = 8;
    private const int MaxPasswordLength = 128;

    /// <summary>Fallback verify target when the email is unknown, so both 401 paths cost one argon2.</summary>
    private static readonly Lazy<Task<string>> DummyHash = new(() =>
        Argon2PasswordHasher.HashAsync(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))));

    public static void Map(IEndpointRouteBuilder app)
    {
        // All public: the global Nest AuthGuard skipped this controller via @Public().
        // The writes share ONE strict auth-bucket counter per client, exactly as Node's
        // single wildcard handler pooled them; get-session stays in the lenient default
        // bucket (the SPA polls it on every navigation).
        app.MapPost("/api/auth/sign-up/email", SignUpAsync).ThrottleAuthBucket("better-auth");
        app.MapPost("/api/auth/sign-in/email", SignInAsync).ThrottleAuthBucket("better-auth");
        app.MapPost("/api/auth/sign-out", SignOutAsync).ThrottleAuthBucket("better-auth");
        app.MapGet("/api/auth/get-session", GetSessionAsync);
        app.MapPost("/api/auth/request-password-reset", RequestPasswordResetAsync)
            .ThrottleAuthBucket("better-auth");
    }

    private static async Task<IResult> SignUpAsync(
        SignUpRequestBody body,
        HttpContext http,
        IdentityDbContext db,
        IOptionsMonitor<SessionAuthenticationOptions> auth,
        CancellationToken cancellationToken)
    {
        var errors = new List<string>();
        ValidateEmailField(body.Email, errors);
        ValidateRequiredString(body.Password, "password", errors);
        ValidateRequiredString(body.Name, "name", errors);
        if (errors.Count > 0)
        {
            return ValidationError(errors);
        }

        if (PasswordLengthError(body.Password!) is { } lengthError)
        {
            return lengthError;
        }

        var email = NormalizeEmail(body.Email!);
        if (await db.Users.AnyAsync(user => user.Email == email, cancellationToken))
        {
            return EmailTaken();
        }

        var now = DateTime.UtcNow;
        var user = new UserRow
        {
            Id = BetterAuthDefaults.GenerateId(32),
            Email = email,
            EmailVerified = false,
            Name = body.Name,
            Image = null,
            Tier = AccountTier.PersonalFree,
            IsSuperAdmin = false,
            MapPreferences = System.Text.Json.JsonDocument.Parse("{}"),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Users.Add(user);
        db.Accounts.Add(new AccountRow
        {
            Id = BetterAuthDefaults.GenerateId(32),
            UserId = user.Id,
            AccountId = user.Id,
            ProviderId = "credential",
            Password = await Argon2PasswordHasher.HashAsync(body.Password!),
            CreatedAt = now,
            UpdatedAt = now,
        });
        var session = NewSession(db, user.Id, http, now);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (IsUniqueViolation(exception))
        {
            return EmailTaken();
        }

        IssueSessionCredential(http, session.Token, auth.Get(SessionAuthenticationDefaults.SchemeName).Secret);
        return Results.Json(new SignUpResponseBody(session.Token, UserPayload(user)));
    }

    private static async Task<IResult> SignInAsync(
        SignInRequestBody body,
        HttpContext http,
        IdentityDbContext db,
        IOptionsMonitor<SessionAuthenticationOptions> auth,
        CancellationToken cancellationToken)
    {
        var errors = new List<string>();
        ValidateEmailField(body.Email, errors);
        ValidateRequiredString(body.Password, "password", errors);
        if (errors.Count > 0)
        {
            return ValidationError(errors);
        }

        var email = NormalizeEmail(body.Email!);
        var user = await db.Users.FirstOrDefaultAsync(row => row.Email == email, cancellationToken);
        var account = user is null
            ? null
            : await db.Accounts
                .FirstOrDefaultAsync(
                    row => row.UserId == user.Id && row.ProviderId == "credential" && row.Password != null,
                    cancellationToken);
        var storedHash = account?.Password ?? await DummyHash.Value;
        if (!await Argon2PasswordHasher.VerifyAsync(storedHash, body.Password!) || user is null || account is null)
        {
            return InvalidCredentials();
        }

        var now = DateTime.UtcNow;
        if (Argon2PasswordHasher.NeedsRehash(storedHash))
        {
            // Decision 7 sub-decision 2: rehash-on-login is the parameter-upgrade path.
            account.Password = await Argon2PasswordHasher.HashAsync(body.Password!);
            account.UpdatedAt = now;
        }

        var session = NewSession(db, user.Id, http, now);
        await db.SaveChangesAsync(cancellationToken);

        IssueSessionCredential(http, session.Token, auth.Get(SessionAuthenticationDefaults.SchemeName).Secret);
        return Results.Json(new SignInResponseBody(false, session.Token, UserPayload(user)));
    }

    private static async Task<IResult> SignOutAsync(
        HttpContext http,
        IdentityDbContext db,
        IOptionsMonitor<SessionAuthenticationOptions> auth,
        CancellationToken cancellationToken)
    {
        var token = SessionTokenCodec.Extract(http.Request, auth.Get(SessionAuthenticationDefaults.SchemeName).Secret);
        if (token is not null)
        {
            await db.Sessions.Where(row => row.Token == token).ExecuteDeleteAsync(cancellationToken);
        }

        // Node clears all three cookies and answers 200 even without a session.
        ClearCookie(http, SessionTokenCodec.CookieName);
        ClearCookie(http, SessionDataCookie);
        ClearCookie(http, DontRememberCookie);
        return Results.Json(new SignOutResponseBody(true));
    }

    private static async Task<IResult> GetSessionAsync(
        HttpContext http,
        IdentityDbContext db,
        IOptionsMonitor<SessionAuthenticationOptions> auth,
        CancellationToken cancellationToken)
    {
        var secret = auth.Get(SessionAuthenticationDefaults.SchemeName).Secret;
        var token = SessionTokenCodec.Extract(http.Request, secret);
        if (token is null)
        {
            return NullSession();
        }

        var now = DateTime.UtcNow;
        var found = await db.Sessions
            .Where(row => row.Token == token && row.ExpiresAt > now)
            .Join(db.Users, row => row.UserId, user => user.Id, (session, user) => new { session, user })
            .FirstOrDefaultAsync(cancellationToken);
        if (found is null)
        {
            return NullSession();
        }

        // The authentication handler already slid the expiry if it was due (it runs before
        // every endpoint) and flagged it; Better Auth answers a refresh with a fresh cookie
        // (and the bearer plugin re-echoes its header), so surface that here.
        if (http.Items.ContainsKey(SessionAuthenticationDefaults.RefreshedItemKey))
        {
            IssueSessionCredential(http, token, secret);
        }

        return Results.Json(new GetSessionResponseBody(SessionPayload(found.session), UserPayload(found.user)));
    }

    private static async Task<IResult> RequestPasswordResetAsync(
        PasswordResetRequestBody body,
        IdentityDbContext db,
        CancellationToken cancellationToken)
    {
        var errors = new List<string>();
        ValidateEmailField(body.Email, errors);
        if (errors.Count > 0)
        {
            return ValidationError(errors);
        }

        var email = NormalizeEmail(body.Email!);
        var userId = await db.Users
            .Where(user => user.Email == email)
            .Select(user => user.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (userId is not null)
        {
            // The token row Better Auth writes before calling the (no-op) sender. An email
            // service turns this into a real reset flow without touching the shim again.
            var now = DateTime.UtcNow;
            db.Verifications.Add(new VerificationRow
            {
                Id = BetterAuthDefaults.GenerateId(32),
                Identifier = $"reset-password:{BetterAuthDefaults.GenerateId(24)}",
                Value = userId,
                ExpiresAt = now + TimeSpan.FromHours(1),
                CreatedAt = now,
                UpdatedAt = now,
            });
            await db.SaveChangesAsync(cancellationToken);
        }

        // Identical body whether or not the email exists (anti-enumeration).
        return Results.Json(new PasswordResetResponseBody(
            true, "If this email exists in our system, check your email for the reset link"));
    }

    private static SessionRow NewSession(IdentityDbContext db, string userId, HttpContext http, DateTime now)
    {
        var session = new SessionRow
        {
            Id = BetterAuthDefaults.GenerateId(32),
            UserId = userId,
            Token = BetterAuthDefaults.GenerateId(32),
            ExpiresAt = now + BetterAuthDefaults.SessionTtl,
            IpAddress = ClientIp(http),
            UserAgent = NullIfEmpty(http.Request.Headers.UserAgent.ToString()),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Sessions.Add(session);
        return session;
    }

    /// <summary>Sets the signed session cookie and the bearer plugin's <c>set-auth-token</c> echo.</summary>
    private static void IssueSessionCredential(HttpContext http, string token, string secret)
    {
        var signed = SessionTokenCodec.Sign(token, secret);
        http.Response.Headers[SetAuthTokenHeader] = signed;
        http.Response.Headers.AccessControlExposeHeaders = SetAuthTokenHeader;
        // Cookies.Append percent-encodes the value itself, landing on Node's
        // encodeURIComponent(signed) form; the raw signed form goes in the header.
        http.Response.Cookies.Append(SessionTokenCodec.CookieName, signed, new CookieOptions
        {
            MaxAge = BetterAuthDefaults.SessionTtl,
            Path = "/",
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
        });
    }

    private static void ClearCookie(HttpContext http, string name) =>
        http.Response.Cookies.Append(name, string.Empty, new CookieOptions
        {
            MaxAge = TimeSpan.Zero,
            Path = "/",
            HttpOnly = true,
            SameSite = SameSiteMode.Lax,
        });

    private static string? ClientIp(HttpContext http)
    {
        var forwarded = http.Request.Headers["X-Forwarded-For"].ToString();
        if (forwarded.Length > 0)
        {
            var first = forwarded.Split(',')[0].Trim();
            if (first.Length > 0)
            {
                return first;
            }
        }

        return http.Connection.RemoteIpAddress?.ToString();
    }

    private static string? NullIfEmpty(string value) => value.Length == 0 ? null : value;

    private static string NormalizeEmail(string email) =>
#pragma warning disable CA1308 // Better Auth normalizes emails to LOWERcase; uppercase would not match stored rows.
        email.Trim().ToLowerInvariant();
#pragma warning restore CA1308

    private static void ValidateEmailField(string? email, List<string> errors)
    {
        if (email is null)
        {
            errors.Add("[body.email] Invalid input: expected string, received undefined");
        }
        else if (!EmailPattern().IsMatch(email))
        {
            errors.Add("[body.email] Invalid email address");
        }
    }

    private static void ValidateRequiredString(string? value, string field, List<string> errors)
    {
        if (value is null)
        {
            errors.Add($"[body.{field}] Invalid input: expected string, received undefined");
        }
    }

    private static IResult? PasswordLengthError(string password) => password.Length switch
    {
        < MinPasswordLength => BetterAuthError(400, "PASSWORD_TOO_SHORT", "Password too short"),
        > MaxPasswordLength => BetterAuthError(400, "PASSWORD_TOO_LONG", "Password too long"),
        _ => null,
    };

    private static IResult ValidationError(IReadOnlyList<string> errors) =>
        BetterAuthError(400, "VALIDATION_ERROR", string.Join("; ", errors));

    private static IResult EmailTaken() =>
        BetterAuthError(422, "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", "User already exists. Use another email.");

    private static IResult InvalidCredentials() =>
        BetterAuthError(401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password");

    private static IResult BetterAuthError(int statusCode, string code, string message) =>
        Results.Json(new BetterAuthErrorBody(message, code), statusCode: statusCode);

    /// <summary>
    /// An unauthenticated get-session is 200 with a JSON <c>null</c> body, not a 401. Written
    /// as literal content because <c>Results.Json(null)</c> produces an EMPTY body, which is
    /// not parseable JSON (the suite asserts <c>JsonValueKind.Null</c>).
    /// </summary>
    private static IResult NullSession() => Results.Content("null", "application/json");

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation };

    private static BetterAuthUserPayload UserPayload(UserRow user) => new(
        user.Name,
        user.Email,
        user.EmailVerified,
        user.Image,
        user.CreatedAt,
        user.UpdatedAt,
        IdentityLabels.Of(user.Tier),
        user.HomeLatitude,
        user.HomeLongitude,
        user.IsSuperAdmin,
        user.Id);

    private static BetterAuthSessionPayload SessionPayload(SessionRow session) => new(
        session.ExpiresAt,
        session.Token,
        session.CreatedAt,
        session.UpdatedAt,
        session.IpAddress,
        session.UserAgent,
        session.UserId,
        session.Id);

    // Zod's email pattern (better-auth validates with z.string().email()), so the same
    // addresses pass and fail on both stacks.
    [GeneratedRegex(@"^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$")]
    private static partial Regex EmailPattern();
}

/// <summary>Shared Better Auth wire constants (session policy and id alphabet).</summary>
internal static class BetterAuthDefaults
{
    /// <summary>30 days (<c>session.expiresIn</c>).</summary>
    public static readonly TimeSpan SessionTtl = TimeSpan.FromDays(30);

    /// <summary>24 hours (<c>session.updateAge</c>): how often a used session's expiry slides.</summary>
    public static readonly TimeSpan UpdateAge = TimeSpan.FromDays(1);

    private const string IdAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    /// <summary>Better Auth's <c>generateId</c>: cryptographically random <c>[a-zA-Z0-9]</c>.</summary>
    public static string GenerateId(int length) =>
        new(RandomNumberGenerator.GetItems<char>(IdAlphabet, length));

    /// <summary>
    /// Whether the sliding refresh is due: the expiry was last set more than
    /// <see cref="UpdateAge"/> ago (Better Auth compares <c>expiresAt - expiresIn + updateAge</c>
    /// against now rather than tracking a last-used column).
    /// </summary>
    public static bool RefreshDue(DateTime expiresAt, DateTime now) =>
        expiresAt - SessionTtl + UpdateAge <= now;
}

internal sealed record SignUpRequestBody(string? Email, string? Password, string? Name);

internal sealed record SignInRequestBody(string? Email, string? Password);

internal sealed record PasswordResetRequestBody(string? Email, string? RedirectTo);

internal sealed record SignUpResponseBody(string Token, BetterAuthUserPayload User);

internal sealed record SignInResponseBody(bool Redirect, string Token, BetterAuthUserPayload User);

internal sealed record SignOutResponseBody(bool Success);

internal sealed record GetSessionResponseBody(BetterAuthSessionPayload Session, BetterAuthUserPayload User);

internal sealed record PasswordResetResponseBody(bool Status, string Message);

internal sealed record BetterAuthErrorBody(string Message, string Code);

/// <summary>The Better Auth user object (property order matches the Node wire).</summary>
internal sealed record BetterAuthUserPayload(
    string? Name,
    string Email,
    bool EmailVerified,
    string? Image,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string Tier,
    double? HomeLatitude,
    double? HomeLongitude,
    bool IsSuperAdmin,
    string Id);

/// <summary>The Better Auth session object served by get-session.</summary>
internal sealed record BetterAuthSessionPayload(
    DateTime ExpiresAt,
    string Token,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string? IpAddress,
    string? UserAgent,
    string UserId,
    string Id);
