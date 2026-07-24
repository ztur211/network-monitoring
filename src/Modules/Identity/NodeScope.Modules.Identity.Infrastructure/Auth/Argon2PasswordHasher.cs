using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Konscious.Security.Cryptography;

namespace NodeScope.Modules.Identity.Infrastructure.Auth;

/// <summary>
/// Argon2id over the PHC string format in <c>Account.password</c>, parameter-compatible with
/// node-argon2's defaults (m=65536 KiB, t=3, p=4, len=32, v=19, 16-byte salt) so every hash
/// minted by the Node stack verifies unchanged. Verification honours the parameters encoded
/// in the stored string rather than the current defaults - that is what makes
/// rehash-on-login a safe parameter-upgrade path (Decision 7, sub-decision 2).
/// </summary>
internal static class Argon2PasswordHasher
{
    private const int MemoryKibibytes = 65536;
    private const int Iterations = 3;
    private const int Parallelism = 4;
    private const int HashLength = 32;
    private const int SaltLength = 16;
    private const int Version = 19;

    public static async Task<string> HashAsync(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltLength);
        var hash = await ComputeAsync(password, salt, MemoryKibibytes, Iterations, Parallelism, HashLength)
            .ConfigureAwait(false);
        return string.Create(
            CultureInfo.InvariantCulture,
            $"$argon2id$v={Version}$m={MemoryKibibytes},t={Iterations},p={Parallelism}${EncodeNoPad(salt)}${EncodeNoPad(hash)}");
    }

    public static async Task<bool> VerifyAsync(string encoded, string password)
    {
        if (Parse(encoded) is not { } parsed)
        {
            return false;
        }

        var computed = await ComputeAsync(
                password, parsed.Salt, parsed.MemoryKibibytes, parsed.Iterations, parsed.Parallelism, parsed.Hash.Length)
            .ConfigureAwait(false);
        return CryptographicOperations.FixedTimeEquals(computed, parsed.Hash);
    }

    /// <summary>Whether a verified hash predates the current parameters (rehash-on-login gate).</summary>
    public static bool NeedsRehash(string encoded) =>
        Parse(encoded) is not { } parsed
        || parsed.MemoryKibibytes != MemoryKibibytes
        || parsed.Iterations != Iterations
        || parsed.Parallelism != Parallelism
        || parsed.Hash.Length != HashLength;

    private static async Task<byte[]> ComputeAsync(
        string password, byte[] salt, int memoryKibibytes, int iterations, int parallelism, int hashLength)
    {
        using var argon2 = new Argon2id(Encoding.UTF8.GetBytes(password))
        {
            Salt = salt,
            MemorySize = memoryKibibytes,
            Iterations = iterations,
            DegreeOfParallelism = parallelism,
        };
        return await argon2.GetBytesAsync(hashLength).ConfigureAwait(false);
    }

    private static ParsedHash? Parse(string encoded)
    {
        // $argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash> - the only shape the Node stack ever wrote.
        var parts = encoded.Split('$');
        if (parts is not ["", "argon2id", var versionPart, var paramsPart, var saltPart, var hashPart]
            || versionPart != $"v={Version}")
        {
            return null;
        }

        int? memory = null, iterations = null, parallelism = null;
        foreach (var parameter in paramsPart.Split(','))
        {
            var separator = parameter.IndexOf('=', StringComparison.Ordinal);
            if (separator <= 0
                || !int.TryParse(parameter[(separator + 1)..], NumberStyles.None, CultureInfo.InvariantCulture, out var parsedValue))
            {
                return null;
            }

            switch (parameter[..separator])
            {
                case "m": memory = parsedValue; break;
                case "t": iterations = parsedValue; break;
                case "p": parallelism = parsedValue; break;
                default: return null;
            }
        }

        if (memory is not { } m || iterations is not { } t || parallelism is not { } p
            || DecodeNoPad(saltPart) is not { } salt || DecodeNoPad(hashPart) is not { } hash
            || salt.Length == 0 || hash.Length == 0)
        {
            return null;
        }

        return new ParsedHash(m, t, p, salt, hash);
    }

    private static string EncodeNoPad(byte[] value) => Convert.ToBase64String(value).TrimEnd('=');

    private static byte[]? DecodeNoPad(string encoded)
    {
        var padded = (encoded.Length % 4) switch
        {
            2 => encoded + "==",
            3 => encoded + "=",
            0 => encoded,
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

    private sealed record ParsedHash(int MemoryKibibytes, int Iterations, int Parallelism, byte[] Salt, byte[] Hash);
}
