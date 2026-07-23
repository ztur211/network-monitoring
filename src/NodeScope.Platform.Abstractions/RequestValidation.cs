namespace NodeScope.Platform.Abstractions;

/// <summary>
/// Hand-rolled request validation helpers producing class-validator-shaped constraint
/// messages ("x must be a string", "x should not be empty"), so the <c>GEN_001</c>
/// validation envelope's <c>details</c> reads like the Node API's.
/// </summary>
public static class RequestValidation
{
    /// <summary>The <c>@IsString() @IsNotEmpty()</c> pair: required, non-empty string.</summary>
    public static void RequireNonEmptyString(ICollection<string> errors, string? value, string field)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (value is null)
        {
            errors.Add($"{field} must be a string");
            errors.Add($"{field} should not be empty");
        }
        else if (value.Length == 0)
        {
            errors.Add($"{field} should not be empty");
        }
    }

    /// <summary>The <c>@MaxLength(n)</c> rule (applies only when the value is present).</summary>
    public static void MaxLength(ICollection<string> errors, string? value, string field, int max)
    {
        ArgumentNullException.ThrowIfNull(errors);
        if (value is not null && value.Length > max)
        {
            errors.Add($"{field} must be shorter than or equal to {max} characters");
        }
    }
}
