// Composition root for the NodeScope API.
//
// Decision 6: minimal APIs, no ControllerBase anywhere. Each module exposes exactly
// one registration extension method and one endpoint-mapping extension method, and
// this file composes them. Business logic does not live here.

using NodeScope.Api;
using NodeScope.Platform.Http;
using Yarp.ReverseProxy.Configuration;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
    // DTOs carry plain DateTime properties; the converter makes them serialize exactly
    // like a JS Date in JSON.stringify (UTC, millisecond precision, Z suffix).
    options.SerializerOptions.Converters.Add(new JsDateTimeConverter()));

builder.Services.AddHealthChecks();

// Decision 21 (transition only, deleted at cutover): while modules land one at a time,
// every route this host does not serve natively is forwarded to the Node API, so the
// contract suite keeps a single BASE_URL and arrange steps (sign-in, org provisioning)
// keep working before Identity is ported. Sessions minted by Node validate here because
// both processes read the same Session table and share BETTER_AUTH_SECRET.
var proxyTarget = builder.Configuration["NODESCOPE_PROXY_TARGET"];
if (!string.IsNullOrEmpty(proxyTarget))
{
    builder.Services.AddReverseProxy().LoadFromMemory(
        routes:
        [
            new RouteConfig
            {
                RouteId = "node-fallback",
                ClusterId = "node",
                // Any natively mapped endpoint (order 0) wins; only unmatched paths fall through.
                Order = 10_000,
                Match = new RouteMatch { Path = "{**catch-all}" },
            },
        ],
        clusters:
        [
            new ClusterConfig
            {
                ClusterId = "node",
                Destinations = new Dictionary<string, DestinationConfig>(StringComparer.Ordinal)
                {
                    ["node"] = new() { Address = proxyTarget },
                },
            },
        ]);
}

var app = builder.Build();

app.UseMiddleware<ApiExceptionMiddleware>();

// This host's own liveness probe. The product's /api/health stays with the module that
// owns the readiness checks and is proxied until that lands.
app.MapHealthChecks("/health");

app.MapBandwidthEndpoints();

if (!string.IsNullOrEmpty(proxyTarget))
{
    app.MapReverseProxy();
}

await app.RunAsync().ConfigureAwait(false);

// No `public partial class Program` declaration here on purpose. The contract suite
// is black-box over BASE_URL (Decision 4) and so never needs the host type. When the
// module-level integration tests arrive (Decision 18) and want WebApplicationFactory,
// expose it with InternalsVisibleTo rather than by making Program public - CA1515 is
// correct that an application's types should stay internal.
