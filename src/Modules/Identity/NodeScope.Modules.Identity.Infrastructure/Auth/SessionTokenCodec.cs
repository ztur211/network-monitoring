using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Auth;

/// <summary>
/// Extracts and verifies the Better Auth session credential, wire-compatible with
/// better-auth 1.6.20 + the bearer plugin (verified against the installed package, not the
/// docs - this is Decision 7's temporary shim, deleted in step 6):
/// <list type="bullet">
/// <item>Cookie <c>better-auth.session_token</c> (or <c>__Secure-</c> prefixed): value is
/// <c>encodeURIComponent("&lt;token&gt;.&lt;HMAC-SHA256(token, secret) standard-base64&gt;")</c>
/// (better-call signs with btoa, NOT base64url).</item>
/// <item><c>Authorization: Bearer</c>: either that same signed form (the <c>set-auth-token</c>
/// header echo) or the raw token - Node "verifies" a raw token by signing it itself, a
/// tautology, so a bare token is accepted and the session lookup decides.</item>
/// <item>Verification decodes the signature leniently (either base64 alphabet, padding
/// optional), matching @better-auth/utils' auto-detecting decoder.</item>
/// </list>
/// </summary>
internal static class SessionTokenCodec
{
    private const string CookieName = "better-auth.session_token";
    private const string SecureCookieName = "__Secure-better-auth.session_token";

    /// <summary>The verified session token carried by the request, or null.</summary>
    public static string? Extract(HttpRequest request, string secret)
    {
        var authorization = request.Headers.Authorization.ToString();
        if (authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            var bearer = authorization["Bearer ".Length..].Trim();
            if (bearer.Length > 0)
            {
                if (!bearer.Contains('.', StringComparison.Ordinal))
                {
                    return bearer;
                }

                var decoded = bearer.Contains('%', StringComparison.Ordinal)
                    ? Uri.UnescapeDataString(bearer)
                    : bearer;
                return VerifySigned(decoded, secret);
            }
        }

        var cookie = request.Cookies[CookieName] ?? request.Cookies[SecureCookieName];
        if (string.IsNullOrEmpty(cookie))
        {
            return null;
        }

        var value = cookie.Contains('%', StringComparison.Ordinal)
            ? Uri.UnescapeDataString(cookie)
            : cookie;
        return VerifySigned(value, secret);
    }

    private static string? VerifySigned(string value, string secret)
    {
        var separator = value.LastIndexOf('.');
        if (separator <= 0 || separator == value.Length - 1)
        {
            return null;
        }

        var token = value[..separator];
        var signature = DecodeBase64Lenient(value[(separator + 1)..]);
        if (signature is null)
        {
            return null;
        }

        var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(token));
        return CryptographicOperations.FixedTimeEquals(expected, signature) ? token : null;
    }

    /// <summary>Accepts both base64 alphabets, with or without padding.</summary>
    private static byte[]? DecodeBase64Lenient(string encoded)
    {
        var normalized = encoded.Replace('-', '+').Replace('_', '/').TrimEnd('=');
        var padded = (normalized.Length % 4) switch
        {
            2 => normalized + "==",
            3 => normalized + "=",
            0 => normalized,
            _ => null,
        };
        if (padded is null)
        {
            return null;
        }

        var buffer = new byte[padded.Length / 4 * 3];
        return Convert.TryFromBase64String(padded, buffer, out var written)
            ? buffer.AsSpan(0, written).ToArray()
            : null;
    }
}
