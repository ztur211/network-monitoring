using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Platform.Http;

/// <summary>
/// The C# equivalent of the Node API's <c>GlobalExceptionFilter</c>: everything a request
/// throws is translated to the error envelope. <see cref="ApiException"/> passes through
/// verbatim; malformed/oversized bodies map to <c>GEN_001 MALFORMED_REQUEST</c> with the
/// framework's 4xx status; anything else is logged and becomes 500 <c>GEN_003</c>.
/// </summary>
public sealed partial class ApiExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ApiExceptionMiddleware> _logger;

    public ApiExceptionMiddleware(RequestDelegate next, ILogger<ApiExceptionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    [System.Diagnostics.CodeAnalysis.SuppressMessage(
        "Design",
        "CA1031:Do not catch general exception types",
        Justification = "This is the request pipeline's last line of defense; translating every "
            + "escaped exception into the 500 envelope is its entire purpose.")]
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        try
        {
            await _next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // The client went away; there is nobody to write an envelope to.
        }
        catch (ApiException exception)
        {
            await WriteErrorAsync(context, exception.StatusCode, exception.Code, exception.Message, exception.Details);
        }
        catch (BadHttpRequestException exception)
        {
            // Unparseable JSON, bad Content-Encoding, oversized body: the Node filter mapped
            // these body-parser 4xxs to GEN_001 MALFORMED_REQUEST at the framework's status.
            await WriteErrorAsync(context, exception.StatusCode, "GEN_001", "MALFORMED_REQUEST", details: null);
        }
        catch (Exception exception)
        {
            Log.UnhandledException(_logger, exception);
            await WriteErrorAsync(context, StatusCodes.Status500InternalServerError, "GEN_003", "INTERNAL_ERROR", details: null);
        }
    }

    private static async Task WriteErrorAsync(
        HttpContext context,
        int statusCode,
        string code,
        string message,
        IReadOnlyList<string>? details)
    {
        if (context.Response.HasStarted)
        {
            // Too late to replace the body; abort so the client sees a broken response
            // rather than a half-JSON one claiming success.
            context.Abort();
            return;
        }

        context.Response.Clear();
        context.Response.StatusCode = statusCode;
        await context.Response.WriteAsJsonAsync(
            new ApiErrorEnvelope(false, new ApiErrorBody(code, message, details), IsoTimestamp.Now()),
            context.RequestAborted);
    }

    private static partial class Log
    {
        [LoggerMessage(Level = LogLevel.Error, Message = "Unhandled exception")]
        public static partial void UnhandledException(ILogger logger, Exception exception);
    }
}
