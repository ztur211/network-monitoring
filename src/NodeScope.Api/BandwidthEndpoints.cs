using System.Security.Cryptography;
using NodeScope.Platform.Http;

namespace NodeScope.Api;

/// <summary>
/// The client speed-test echo, ported from the Node <c>bandwidth</c> module. It lives in
/// the host rather than a module because it has no domain: no auth, no DTO, no database -
/// just raw bytes for throughput measurement. Public and unthrottled by design.
/// </summary>
internal static class BandwidthEndpoints
{
    private const int PayloadBytes = 1_000_000;

    // Generated once at startup, random so the payload is incompressible on the wire and
    // download timing measures real throughput (matches the Node module-load buffer).
    private static readonly byte[] Payload = CreatePayload();

    public static IEndpointRouteBuilder MapBandwidthEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/bandwidth/echo", Download);
        app.MapPost("/api/bandwidth/echo", UploadAsync);
        return app;
    }

    private static IResult Download(HttpContext context)
    {
        context.Response.Headers.CacheControl = "no-store";
        return Results.Bytes(Payload, "application/octet-stream");
    }

    private static async Task<IResult> UploadAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        // Drain whatever the client sends (including an empty body) and acknowledge.
        await request.Body.CopyToAsync(Stream.Null, cancellationToken);
        return Results.NoContent();
    }

    private static byte[] CreatePayload()
    {
        var payload = new byte[PayloadBytes];
        RandomNumberGenerator.Fill(payload);
        return payload;
    }
}
