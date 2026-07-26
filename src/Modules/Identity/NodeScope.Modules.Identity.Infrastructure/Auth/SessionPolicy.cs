using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Auth;

/// <summary>
/// Session lifetime policy and credential wire. The policy values carry over from the
/// Better Auth era unchanged (they shaped every existing Session row); the credential
/// is native since 2026-07-26: the raw session token as an <c>Authorization: Bearer</c>
/// header, nothing else - no cookies, no HMAC signing, no header echo.
/// </summary>
internal static class SessionPolicy
{
    /// <summary>30 days.</summary>
    public static readonly TimeSpan SessionTtl = TimeSpan.FromDays(30);

    /// <summary>24 hours: how often a used session's expiry slides.</summary>
    public static readonly TimeSpan UpdateAge = TimeSpan.FromDays(1);

    private const string IdAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    /// <summary>Cryptographically random <c>[a-zA-Z0-9]</c> ids and tokens.</summary>
    public static string GenerateId(int length) =>
        new(RandomNumberGenerator.GetItems<char>(IdAlphabet, length));

    /// <summary>
    /// Whether the sliding refresh is due: the expiry was last set more than
    /// <see cref="UpdateAge"/> ago (computed off the expiry itself rather than
    /// tracking a last-used column).
    /// </summary>
    public static bool RefreshDue(DateTime expiresAt, DateTime now) =>
        expiresAt - SessionTtl + UpdateAge <= now;

    /// <summary>The Bearer session token carried by the request, or null.</summary>
    public static string? ExtractBearer(HttpRequest request)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var token = authorization["Bearer ".Length..].Trim();
        return token.Length > 0 ? token : null;
    }
}
