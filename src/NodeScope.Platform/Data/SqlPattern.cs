namespace NodeScope.Platform.Data;

/// <summary>Helpers for values that reach SQL as patterns rather than as plain operands.</summary>
public static class SqlPattern
{
    /// <summary>
    /// Escapes the <c>LIKE</c>/<c>ILIKE</c> metacharacters so a literal string compares as
    /// itself. This is how the port expresses Prisma's <c>mode: 'insensitive'</c> equality:
    /// <c>ILIKE</c> with an escaped pattern is case-insensitive equality, and without the
    /// escaping a name containing <c>%</c> or <c>_</c> would match unrelated rows.
    /// </summary>
    public static string EscapeLike(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return value
            .Replace(@"\", @"\\", StringComparison.Ordinal)
            .Replace("%", @"\%", StringComparison.Ordinal)
            .Replace("_", @"\_", StringComparison.Ordinal);
    }
}
