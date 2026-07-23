using System.Text.RegularExpressions;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Domain;

/// <summary>The org device-naming policy (Node's <c>naming-policy.ts</c>).</summary>
public static class NamingPolicy
{
    /// <summary>
    /// Throws <c>ORG_006</c>/422 when the name exceeds the policy length or misses the
    /// pattern. An unparseable pattern disables the pattern check, exactly like Node's
    /// <c>catch {{ return; }}</c> on RegExp construction.
    /// </summary>
    public static void AssertNameMatchesPolicy(string name, string? namingPattern, int? namingMaxLen)
    {
        ArgumentNullException.ThrowIfNull(name);
        var maxLen = namingMaxLen ?? 63;
        if (name.Length > maxLen)
        {
            throw Violation();
        }

        if (string.IsNullOrEmpty(namingPattern))
        {
            return;
        }

        Regex regex;
        try
        {
            regex = new Regex(namingPattern, RegexOptions.None, TimeSpan.FromSeconds(1));
        }
        catch (ArgumentException)
        {
            return;
        }

        if (!regex.IsMatch(name))
        {
            throw Violation();
        }
    }

    private static ApiException Violation() => new("ORG_006", "NAMING_POLICY_VIOLATION", 422);
}
