using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using NodeScope.Modules.Identity.Application;
using NodeScope.Modules.Identity.Domain;
using NodeScope.Modules.Identity.Infrastructure.Persistence;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Auth;

/// <summary>
/// The native auth surface at <c>/api/v1/auth</c> (2026-07-26, replacing Decision 7's
/// Better Auth wire shim once the desktop client became the only auth consumer). Speaks
/// the NodeScope envelope like every other route; a successful credential post returns
/// only <c>{ token }</c> - the caller reads its profile from <c>/api/v1/users/me</c>,
/// the one pinned user shape. The credential is the raw session token as a Bearer
/// header (<see cref="SessionPolicy.ExtractBearer"/>); no cookies exist anymore.
/// </summary>
internal static partial class AuthEndpoints
{
    private const int MinPasswordLength = 8;
    private const int MaxPasswordLength = 128;

    /// <summary>Fallback verify target when the email is unknown, so both 401 paths cost one argon2.</summary>
    private static readonly Lazy<Task<string>> DummyHash = new(() =>
        Argon2PasswordHasher.HashAsync(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))));

    public static void Map(IEndpointRouteBuilder app)
    {
        // The credential writes share ONE strict auth-bucket counter per client
        // (5 per 15 minutes in production), like the Node era pooled them.
        app.MapPost("/api/v1/auth/sign-up", SignUpAsync).ThrottleAuthBucket("auth");
        app.MapPost("/api/v1/auth/sign-in", SignInAsync).ThrottleAuthBucket("auth");
        app.MapPost("/api/v1/auth/sign-out", SignOutAsync).RequireAuthorization().ThrottleAuthBucket("auth");
    }

    private static async Task<IResult> SignUpAsync(
        SignUpRequestBody body,
        HttpContext http,
        IdentityDbContext db,
        CancellationToken cancellationToken)
    {
        var errors = new List<string>();
        ValidateEmail(body.Email, errors);
        RequestValidation.RequireNonEmptyString(errors, body.Name, "name");
        ValidatePassword(body.Password, errors);
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
        }

        var email = NormalizeEmail(body.Email!);
        if (await db.Users.AnyAsync(user => user.Email == email, cancellationToken))
        {
            throw IdentityErrors.EmailTaken();
        }

        var now = DateTime.UtcNow;
        var user = new UserRow
        {
            Id = SessionPolicy.GenerateId(32),
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
            Id = SessionPolicy.GenerateId(32),
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
            throw IdentityErrors.EmailTaken();
        }

        return ApiEnvelope.Created(new SessionTokenPayload(session.Token));
    }

    private static async Task<IResult> SignInAsync(
        SignInRequestBody body,
        HttpContext http,
        IdentityDbContext db,
        CancellationToken cancellationToken)
    {
        var errors = new List<string>();
        ValidateEmail(body.Email, errors);
        RequestValidation.RequireNonEmptyString(errors, body.Password, "password");
        if (errors.Count > 0)
        {
            throw ApiErrors.Validation(errors);
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
            throw new ApiException("AUTH_001", "INVALID_CREDENTIALS", 401);
        }

        var now = DateTime.UtcNow;
        if (Argon2PasswordHasher.NeedsRehash(storedHash))
        {
            // Rehash-on-login is the parameter-upgrade path (Decision 7 sub-decision 2).
            account.Password = await Argon2PasswordHasher.HashAsync(body.Password!);
            account.UpdatedAt = now;
        }

        var session = NewSession(db, user.Id, http, now);
        await db.SaveChangesAsync(cancellationToken);

        return ApiEnvelope.Ok(new SessionTokenPayload(session.Token));
    }

    private static async Task<IResult> SignOutAsync(
        HttpContext http,
        IdentityDbContext db,
        CancellationToken cancellationToken)
    {
        // The route requires authorization, so a valid token is present; deleting the
        // Session row revokes it everywhere immediately (no cookie cache to outlive it).
        var token = SessionPolicy.ExtractBearer(http.Request);
        if (token is not null)
        {
            await db.Sessions.Where(row => row.Token == token).ExecuteDeleteAsync(cancellationToken);
        }

        return Results.NoContent();
    }

    private static SessionRow NewSession(IdentityDbContext db, string userId, HttpContext http, DateTime now)
    {
        var session = new SessionRow
        {
            Id = SessionPolicy.GenerateId(32),
            UserId = userId,
            Token = SessionPolicy.GenerateId(32),
            ExpiresAt = now + SessionPolicy.SessionTtl,
            IpAddress = ClientIp(http),
            UserAgent = NullIfEmpty(http.Request.Headers.UserAgent.ToString()),
            CreatedAt = now,
            UpdatedAt = now,
        };
        db.Sessions.Add(session);
        return session;
    }

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
#pragma warning disable CA1308 // emails normalize to LOWERcase; uppercase would not match stored rows.
        email.Trim().ToLowerInvariant();
#pragma warning restore CA1308

    private static void ValidateEmail(string? email, List<string> errors)
    {
        if (email is null || !EmailPattern().IsMatch(email))
        {
            errors.Add("email must be a valid email address");
        }
    }

    private static void ValidatePassword(string? password, List<string> errors)
    {
        if (password is null)
        {
            errors.Add("password should not be empty");
        }
        else if (password.Length is < MinPasswordLength or > MaxPasswordLength)
        {
            errors.Add($"password must be between {MinPasswordLength} and {MaxPasswordLength} characters");
        }
    }

    private static bool IsUniqueViolation(DbUpdateException exception) =>
        exception.InnerException is Npgsql.PostgresException { SqlState: Npgsql.PostgresErrorCodes.UniqueViolation };

    // The same address set the Node stack accepted (zod's email pattern), kept so no
    // existing account's email becomes unenterable on the new wire.
    [GeneratedRegex(@"^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$")]
    private static partial Regex EmailPattern();
}

internal sealed record SignUpRequestBody(string? Name, string? Email, string? Password);

internal sealed record SignInRequestBody(string? Email, string? Password);

/// <summary>A credential post's whole answer: the Bearer session token.</summary>
internal sealed record SessionTokenPayload(string Token);
