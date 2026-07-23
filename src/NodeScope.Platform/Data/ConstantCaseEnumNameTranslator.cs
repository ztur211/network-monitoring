using Npgsql;

namespace NodeScope.Platform.Data;

/// <summary>
/// Translates C# PascalCase enum members to the schema's CONSTANT_CASE Postgres enum labels:
/// an underscore at each lower-to-upper boundary, then uppercase. <c>AuthPriv</c> -&gt;
/// <c>AUTH_PRIV</c>, <c>V2C</c> -&gt; <c>V2C</c>, <c>Sha256</c> -&gt; <c>SHA256</c>. Domain
/// enums stay attribute-free (they must not reference Npgsql), so the mapping lives here.
/// </summary>
public sealed class ConstantCaseEnumNameTranslator : INpgsqlNameTranslator
{
    /// <summary>
    /// The shared instance every MapEnum call must use: options-level equality is by
    /// reference, and a fresh translator per options build would defeat EF's internal
    /// service-provider cache (one provider per request until the 20-provider cap throws).
    /// </summary>
    public static ConstantCaseEnumNameTranslator Instance { get; } = new();

    public string TranslateTypeName(string clrName) => clrName;

    public string TranslateMemberName(string clrName)
    {
        ArgumentNullException.ThrowIfNull(clrName);
        var result = new System.Text.StringBuilder(clrName.Length + 4);
        for (var i = 0; i < clrName.Length; i++)
        {
            if (i > 0 && char.IsUpper(clrName[i]) && char.IsLower(clrName[i - 1]))
            {
                result.Append('_');
            }

            result.Append(char.ToUpperInvariant(clrName[i]));
        }

        return result.ToString();
    }
}
