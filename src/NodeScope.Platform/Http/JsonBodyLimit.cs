using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;

namespace NodeScope.Platform.Http;

/// <summary>
/// The Node API's explicit <c>express.json({ limit: '1mb' })</c>, ported: every JSON body is
/// capped at 1 MiB, measured on the INFLATED bytes (request decompression honors the same
/// feature), so gzip cannot smuggle a larger payload past it. Oversized bodies surface as
/// 413 <c>GEN_001 MALFORMED_REQUEST</c> through the exception middleware, exactly like the
/// Node filter's body-parser branch.
/// </summary>
public static class JsonBodyLimit
{
    public const long MaxJsonBodyBytes = 1_048_576;

    public static IApplicationBuilder UseJsonBodyLimit(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.Use(static async (context, next) =>
        {
            if (context.Request.ContentType?.Contains("application/json", StringComparison.OrdinalIgnoreCase) == true)
            {
                var feature = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
                if (feature is { IsReadOnly: false })
                {
                    feature.MaxRequestBodySize = MaxJsonBodyBytes;
                }
            }

            await next(context);
        });
    }
}
