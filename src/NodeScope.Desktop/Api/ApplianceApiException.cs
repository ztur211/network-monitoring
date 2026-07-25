namespace NodeScope.Desktop.Api;

/// <summary>
/// An error envelope from the appliance (<c>{ success: false, error: { code, message } }</c>),
/// or <see cref="ProtocolErrorCode"/> when the response is not the NodeScope envelope at all
/// (wrong URL, proxy error page). Transport failures stay <see cref="HttpRequestException"/>.
/// </summary>
internal sealed class ApplianceApiException : Exception
{
    /// <summary>The code used when the body cannot be read as a NodeScope envelope.</summary>
    public const string ProtocolErrorCode = "PROTOCOL_ERROR";

    public ApplianceApiException(string code, string message, int status)
        : base(message)
    {
        Code = code;
        Status = status;
    }

    // The standard constructors (CA1032) degrade to the protocol-error shape: no code
    // from the wire means the wire itself was not the API.
    public ApplianceApiException()
        : this(ProtocolErrorCode, "The server did not answer with the NodeScope API envelope.", 0)
    {
    }

    public ApplianceApiException(string message)
        : this(ProtocolErrorCode, message, 0)
    {
    }

    public ApplianceApiException(string message, Exception innerException)
        : base(message, innerException)
    {
        Code = ProtocolErrorCode;
        Status = 0;
    }

    public string Code { get; }

    public int Status { get; }
}
