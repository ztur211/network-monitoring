using System.Text.RegularExpressions;

namespace NodeScope.Modules.Inventory.Domain;

/// <summary>Location tokens for device-name templates (Node's <c>naming-tokens.ts</c>).</summary>
public sealed record LocationTokens(string Site, string Building, string Floor, string Area, string Role);

/// <summary>Template rendering for name suggestions.</summary>
public static partial class NamingTokens
{
    public const string SeqToken = "{seq}";

    /// <summary>
    /// Substitutes every token except <c>{seq}</c>, collapses separator runs left by empty
    /// tokens, and trims separator edges.
    /// </summary>
    public static string RenderTemplate(string template, LocationTokens tokens)
    {
        ArgumentNullException.ThrowIfNull(template);
        ArgumentNullException.ThrowIfNull(tokens);
        var substituted = template
            .Replace("{site}", tokens.Site, StringComparison.Ordinal)
            .Replace("{building}", tokens.Building, StringComparison.Ordinal)
            .Replace("{floor}", tokens.Floor, StringComparison.Ordinal)
            .Replace("{area}", tokens.Area, StringComparison.Ordinal)
            .Replace("{role}", tokens.Role, StringComparison.Ordinal);

        // Protect {seq} from separator-collapsing.
        var segments = substituted.Split(SeqToken);
        var cleaned = segments.Select(segment => SeparatorRuns().Replace(segment, match => match.Value[..1]));
        return string.Join(SeqToken, cleaned).Trim('-', '_');
    }

    public static bool HasSeqToken(string rendered)
    {
        ArgumentNullException.ThrowIfNull(rendered);
        return rendered.Contains(SeqToken, StringComparison.Ordinal);
    }

    public static string FillSeq(string rendered, string seq)
    {
        ArgumentNullException.ThrowIfNull(rendered);
        var index = rendered.IndexOf(SeqToken, StringComparison.Ordinal);
        return index < 0 ? rendered : rendered[..index] + seq + rendered[(index + SeqToken.Length)..];
    }

    [GeneratedRegex("[-_]{2,}")]
    private static partial Regex SeparatorRuns();
}
