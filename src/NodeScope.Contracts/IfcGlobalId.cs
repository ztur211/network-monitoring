using System.Globalization;
using System.Numerics;

namespace NodeScope.Contracts;

/// <summary>
/// Losslessly encodes a UUID as an IFC GlobalId. Non-UUID seeds use the same
/// deterministic 128-bit fold so every NodeScope client and exporter agrees on
/// the durable BIM identifier for a device.
/// </summary>
public static class IfcGlobalId
{
    private const string Base64Alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

    private static readonly BigInteger Mask128 = (BigInteger.One << 128) - 1;

    public static string Of(string seed)
    {
        ArgumentNullException.ThrowIfNull(seed);
        var hex = seed.Replace("-", "", StringComparison.Ordinal);
        var value = IsUuidHex(hex)
            ? BigInteger.Parse("0" + hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture)
            : Fold(seed);

        var chars = new char[22];
        for (var index = chars.Length - 1; index >= 0; index--)
        {
            chars[index] = Base64Alphabet[(int)(value % 64)];
            value /= 64;
        }

        return new string(chars);
    }

    private static bool IsUuidHex(string hex) =>
        hex.Length == 32 && hex.All(Uri.IsHexDigit);

    private static BigInteger Fold(string seed)
    {
        var hash = new BigInteger(0xcbf29ce484222325UL);
        foreach (var character in seed)
        {
            hash = ((hash ^ character) * 0x100000001b3) & Mask128;
        }

        return (hash ^ (new BigInteger(seed.Length) << 64)) & Mask128;
    }
}
