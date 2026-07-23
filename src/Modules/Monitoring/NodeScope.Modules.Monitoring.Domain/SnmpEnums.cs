namespace NodeScope.Modules.Monitoring.Domain;

/// <summary>The <c>SnmpVersion</c> Postgres enum.</summary>
public enum SnmpVersion
{
    V2C,
    V3,
}

/// <summary>The <c>SnmpSecurityLevel</c> Postgres enum (labels via the CONSTANT_CASE translator).</summary>
public enum SnmpSecurityLevel
{
    NoAuthNoPriv,
    AuthNoPriv,
    AuthPriv,
}

/// <summary>The <c>SnmpAuthProtocol</c> Postgres enum.</summary>
public enum SnmpAuthProtocol
{
    Md5,
    Sha,
    Sha256,
}

/// <summary>The <c>SnmpPrivProtocol</c> Postgres enum.</summary>
public enum SnmpPrivProtocol
{
    Des,
    Aes,
    Aes256,
}

/// <summary>Wire-label conversion for the SNMP enums (the DB labels are the wire values).</summary>
public static class SnmpLabels
{
    public static string Of(SnmpVersion value) => value switch
    {
        SnmpVersion.V2C => "V2C",
        SnmpVersion.V3 => "V3",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Of(SnmpSecurityLevel value) => value switch
    {
        SnmpSecurityLevel.NoAuthNoPriv => "NO_AUTH_NO_PRIV",
        SnmpSecurityLevel.AuthNoPriv => "AUTH_NO_PRIV",
        SnmpSecurityLevel.AuthPriv => "AUTH_PRIV",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Of(SnmpAuthProtocol value) => value switch
    {
        SnmpAuthProtocol.Md5 => "MD5",
        SnmpAuthProtocol.Sha => "SHA",
        SnmpAuthProtocol.Sha256 => "SHA256",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static string Of(SnmpPrivProtocol value) => value switch
    {
        SnmpPrivProtocol.Des => "DES",
        SnmpPrivProtocol.Aes => "AES",
        SnmpPrivProtocol.Aes256 => "AES256",
        _ => throw new ArgumentOutOfRangeException(nameof(value)),
    };

    public static SnmpVersion ParseVersion(string label) => label switch
    {
        "V2C" => SnmpVersion.V2C,
        "V3" => SnmpVersion.V3,
        _ => throw new ArgumentOutOfRangeException(nameof(label)),
    };

    public static SnmpSecurityLevel ParseSecurityLevel(string label) => label switch
    {
        "NO_AUTH_NO_PRIV" => SnmpSecurityLevel.NoAuthNoPriv,
        "AUTH_NO_PRIV" => SnmpSecurityLevel.AuthNoPriv,
        "AUTH_PRIV" => SnmpSecurityLevel.AuthPriv,
        _ => throw new ArgumentOutOfRangeException(nameof(label)),
    };

    public static SnmpAuthProtocol ParseAuthProtocol(string label) => label switch
    {
        "MD5" => SnmpAuthProtocol.Md5,
        "SHA" => SnmpAuthProtocol.Sha,
        "SHA256" => SnmpAuthProtocol.Sha256,
        _ => throw new ArgumentOutOfRangeException(nameof(label)),
    };

    public static SnmpPrivProtocol ParsePrivProtocol(string label) => label switch
    {
        "DES" => SnmpPrivProtocol.Des,
        "AES" => SnmpPrivProtocol.Aes,
        "AES256" => SnmpPrivProtocol.Aes256,
        _ => throw new ArgumentOutOfRangeException(nameof(label)),
    };
}
