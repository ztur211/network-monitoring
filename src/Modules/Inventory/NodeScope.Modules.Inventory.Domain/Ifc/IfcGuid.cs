using System.Globalization;
using System.Numerics;

namespace NodeScope.Modules.Inventory.Domain.Ifc;

/// <summary>
/// The IFC <c>GlobalId</c> encoding: 128 bits written MSB-first as 22 base-64 characters (the
/// leading character carries the leftover two bits). A real UUID encodes losslessly, so the id
/// stays stable and reversible and AEC coordination diffs work; any other seed is folded
/// deterministically instead. Shared because it is the only join key between BIM elements and
/// NodeScope devices - the exporter writes it and BCF reads it back. It lives in the domain
/// rather than in Contracts because only Inventory speaks IFC today; it moves to Contracts if
/// the desktop client ever needs to derive the same ids.
/// </summary>
public static class IfcGuid
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
        for (var i = 21; i >= 0; i--)
        {
            chars[i] = Base64Alphabet[(int)(value % 64)];
            value /= 64;
        }

        return new string(chars);
    }

    private static bool IsUuidHex(string hex) =>
        hex.Length == 32 && hex.All(Uri.IsHexDigit);

    /// <summary>A 128-bit FNV-1a fold, with the seed length mixed in so equal-prefix seeds spread.</summary>
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
