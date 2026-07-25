namespace NodeScope.Desktop.Auth;

/// <summary>The parsed <c>nodescope://auth/callback?code&amp;state</c> activation.</summary>
internal sealed record ParsedCallback(string Code, string State);

internal static class DesktopCallback
{
    /// <summary>The exact redirect_uri the server allowlists (DAUTH_001 otherwise).</summary>
    public const string RedirectUri = "nodescope://auth/callback";

    public const string Scheme = "nodescope";

    /// <summary>Returns null for anything that is not a well-formed auth callback.</summary>
    public static ParsedCallback? Parse(Uri uri)
    {
        // For a custom scheme URI "nodescope://auth/callback", "auth" parses as the
        // authority and "/callback" as the path.
        if (!string.Equals(uri.Scheme, Scheme, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.Authority, "auth", StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.AbsolutePath, "/callback", StringComparison.Ordinal))
        {
            return null;
        }

        string? code = null;
        string? state = null;
        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = pair.IndexOf('=', StringComparison.Ordinal);
            if (separator < 0)
            {
                continue;
            }

            var key = Uri.UnescapeDataString(pair[..separator]);
            var value = Uri.UnescapeDataString(pair[(separator + 1)..]);
            if (key == "code")
            {
                code = value;
            }
            else if (key == "state")
            {
                state = value;
            }
        }

        return code is { Length: > 0 } && state is { Length: > 0 }
            ? new ParsedCallback(code, state)
            : null;
    }
}
