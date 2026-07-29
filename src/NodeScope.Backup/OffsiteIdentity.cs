using System.Security.Cryptography;
using System.Text;

namespace NodeScope.Backup;

internal sealed record OffsiteIdentity(string PublicKey, string PrivateKey)
{
    private const string Header = "NODESCOPE_OFFSITE_IDENTITY_V1";

    public static OffsiteIdentity Generate()
    {
        using var rsa = RSA.Create(3072);
        return new OffsiteIdentity(
            Convert.ToBase64String(rsa.ExportSubjectPublicKeyInfo()),
            Convert.ToBase64String(rsa.ExportPkcs8PrivateKey()));
    }

    public RSA CreatePublicKey()
    {
        var rsa = RSA.Create();
        try
        {
            rsa.ImportSubjectPublicKeyInfo(Convert.FromBase64String(PublicKey), out _);
            return rsa;
        }
        catch
        {
            rsa.Dispose();
            throw;
        }
    }

    public RSA CreatePrivateKey()
    {
        var rsa = RSA.Create();
        try
        {
            rsa.ImportPkcs8PrivateKey(Convert.FromBase64String(PrivateKey), out _);
            return rsa;
        }
        catch
        {
            rsa.Dispose();
            throw;
        }
    }

    public string Export()
    {
        var output = new StringBuilder();
        output.AppendLine(Header);
        output.Append("PUBKEY=").AppendLine(PublicKey);
        output.Append("PRIVKEY=").AppendLine(PrivateKey);
        return output.ToString();
    }

    public static OffsiteIdentity Parse(string value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value);

        string? publicKey = null;
        string? privateKey = null;
        using var reader = new StringReader(value);
        while (reader.ReadLine() is { } line)
        {
            if (line.StartsWith("PUBKEY=", StringComparison.Ordinal))
            {
                publicKey = line["PUBKEY=".Length..].Trim();
            }
            else if (line.StartsWith("PRIVKEY=", StringComparison.Ordinal))
            {
                privateKey = line["PRIVKEY=".Length..].Trim();
            }
        }

        if (string.IsNullOrWhiteSpace(publicKey) || string.IsNullOrWhiteSpace(privateKey))
        {
            throw new FormatException("The identity must contain PUBKEY and PRIVKEY values.");
        }

        var identity = new OffsiteIdentity(publicKey, privateKey);
        using var publicRsa = identity.CreatePublicKey();
        using var privateRsa = identity.CreatePrivateKey();
        if (!publicRsa.ExportSubjectPublicKeyInfo().AsSpan()
            .SequenceEqual(privateRsa.ExportSubjectPublicKeyInfo()))
        {
            throw new FormatException("The identity public and private keys do not match.");
        }

        return identity;
    }
}
