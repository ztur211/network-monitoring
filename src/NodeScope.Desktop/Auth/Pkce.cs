using System.Security.Cryptography;
using System.Text;

namespace NodeScope.Desktop.Auth;

/// <summary>A PKCE S256 pair for the desktop-auth flow (RFC 7636 mechanics).</summary>
internal sealed record PkcePair(string Verifier, string Challenge);

internal static class Pkce
{
    /// <summary>
    /// 64 random bytes base64url-encoded: an 86-character verifier, inside RFC 7636's
    /// 43..128 bounds and pure base64url alphabet. The challenge is the base64url SHA-256
    /// of the verifier's ASCII bytes - exactly what the server recomputes at exchange.
    /// </summary>
    public static PkcePair NewPair()
    {
        var verifier = Base64Url.Encode(RandomNumberGenerator.GetBytes(64));
        var challenge = Base64Url.Encode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        return new PkcePair(verifier, challenge);
    }

    /// <summary>The CSRF nonce round-tripped through the browser as <c>state</c>.</summary>
    public static string NewState() => Base64Url.Encode(RandomNumberGenerator.GetBytes(16));
}

internal static class Base64Url
{
    public static string Encode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
