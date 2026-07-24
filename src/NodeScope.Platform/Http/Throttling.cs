using System.Globalization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Platform.Http;

/// <summary>One named rate-limit bucket (Node's named throttlers).</summary>
public sealed record ThrottleBucket(string Name, int Limit, TimeSpan Ttl);

/// <summary>
/// The two buckets @nestjs/throttler ran (<c>app.module.ts</c>): <c>default</c> (1 min) and
/// <c>auth</c> (15 min). Production limits are fixed (100 / 5); outside production a harness
/// that fires hundreds of requests per minute (the contract suite) raises them via
/// <c>THROTTLE_DEFAULT_LIMIT</c> / <c>THROTTLE_AUTH_LIMIT</c> (defaults 2000 / 200). The
/// production gate is Node's exact check: <c>NODE_ENV == "production"</c>, which the appliance
/// compose already sets - revisit at Decision 20 if the C# image drops that variable.
/// </summary>
public sealed record ThrottleOptions(IReadOnlyList<ThrottleBucket> Buckets)
{
    public const string DefaultBucket = "default";
    public const string AuthBucket = "auth";

    public static ThrottleOptions FromConfiguration(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);
        var production = configuration["NODE_ENV"] == "production";
        return new ThrottleOptions(
        [
            new ThrottleBucket(
                DefaultBucket,
                production ? 100 : OverridableLimit(configuration, "THROTTLE_DEFAULT_LIMIT", 2000),
                TimeSpan.FromMinutes(1)),
            new ThrottleBucket(
                AuthBucket,
                production ? 5 : OverridableLimit(configuration, "THROTTLE_AUTH_LIMIT", 200),
                TimeSpan.FromMinutes(15)),
        ]);
    }

    private static int OverridableLimit(IConfiguration configuration, string key, int fallback) =>
        int.TryParse(configuration[key], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? value
            : fallback;
}

/// <summary>
/// Which buckets an endpoint is counted against, and under what shared counter key.
/// Endpoints without this metadata sit in the <c>default</c> bucket, keyed per endpoint.
/// </summary>
/// <remarks>
/// This is a membership model, deliberately NOT Node's skip model, and the difference is a
/// recorded behavior FIX (like the agent's SNMPv3 one): @nestjs/throttler fans every named
/// throttler out to every route unless each is individually skipped, and a bare
/// <c>@SkipThrottle()</c> skips only <c>default</c> - so in production Node, the strict
/// 5-per-15-min <c>auth</c> bucket silently applied to EVERY ordinary route (and to health
/// and bandwidth, both "unthrottled by design"). Masked outside production by the lenient
/// dev limits, so no suite ever saw it. Here the auth bucket exists only where a route
/// explicitly opts in, and skipping means skipping everything.
/// </remarks>
public sealed record ThrottleEndpointMetadata(IReadOnlyList<string> Buckets, string? SharedKey);

/// <summary>Endpoint extensions for bucket membership, mirroring the Node decorator sites.</summary>
public static class ThrottleMetadata
{
    private static readonly ThrottleEndpointMetadata Skip = new([], null);

    /// <summary>Exempt from rate limiting entirely (health, bandwidth echo, the hub).</summary>
    public static TBuilder SkipThrottle<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.Add(endpoint => endpoint.Metadata.Add(Skip));
        return builder;
    }

    /// <summary>
    /// Strict auth-bucket-only, under <paramref name="sharedKey"/>: routes passing the same
    /// key share one counter per client, the way Node's wildcard <c>auth/*path</c> handler
    /// pooled every Better Auth write into a single 5-per-15-min budget.
    /// </summary>
    public static TBuilder ThrottleAuthBucket<TBuilder>(this TBuilder builder, string sharedKey)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        var metadata = new ThrottleEndpointMetadata([ThrottleOptions.AuthBucket], sharedKey);
        builder.Add(endpoint => endpoint.Metadata.Add(metadata));
        return builder;
    }
}

/// <summary>
/// The rate-limiting middleware (Node's global <c>ThrottlerGuard</c>). Sits AFTER
/// authorization, matching the Nest guard order (AuthGuard before ThrottlerGuard): a 401/403
/// never consumes throttle budget. Headers reproduce the installed @nestjs/throttler 6.5
/// exactly - <c>X-RateLimit-{Limit,Remaining,Reset}</c> per passing bucket (<c>-auth</c>
/// suffix for the auth bucket, none for default) and <c>Retry-After[-auth]</c> on the 429,
/// whose body is the <c>GEN_004 RATE_LIMITED</c> envelope via the exception middleware.
/// The client key is the peer address (Node keyed on Express <c>req.ip</c>; with
/// <c>trust proxy 1</c> that is the address the trusted hop recorded, so the last
/// <c>X-Forwarded-For</c> entry when one exists).
/// </summary>
public static class Throttling
{
    public static IApplicationBuilder UseThrottling(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.Use(static async (context, next) =>
        {
            var endpoint = context.GetEndpoint();
            if (endpoint is null)
            {
                await next(context);
                return;
            }

            var metadata = endpoint.Metadata.GetMetadata<ThrottleEndpointMetadata>();
            var memberships = metadata?.Buckets ?? [ThrottleOptions.DefaultBucket];
            if (memberships.Count > 0)
            {
                var options = context.RequestServices.GetRequiredService<ThrottleOptions>();
                var store = context.RequestServices.GetRequiredService<ThrottleStore>();
                var client = ClientKey(context);
                var routeKey = metadata?.SharedKey ?? EndpointKey(context, endpoint);
                foreach (var bucket in options.Buckets)
                {
                    if (!memberships.Contains(bucket.Name))
                    {
                        continue;
                    }

                    var suffix = bucket.Name == ThrottleOptions.DefaultBucket ? "" : $"-{bucket.Name}";
                    var result = store.Hit(
                        $"{routeKey}|{bucket.Name}|{client}",
                        bucket.Limit,
                        bucket.Ttl,
                        blockDuration: bucket.Ttl);
                    if (result.IsBlocked)
                    {
                        // Written here rather than thrown: the exception middleware clears
                        // response headers before writing its envelope, and the Retry-After
                        // must survive onto the 429 (Node's guard set it on the same response
                        // the filter then reused).
                        context.Response.Headers[$"Retry-After{suffix}"] =
                            result.TimeToBlockExpireSeconds.ToString(CultureInfo.InvariantCulture);
                        context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                        await context.Response.WriteAsJsonAsync(
                            new ApiErrorEnvelope(
                                false, new ApiErrorBody("GEN_004", "RATE_LIMITED", null), IsoTimestamp.Now()),
                            context.RequestAborted);
                        return;
                    }

                    context.Response.Headers[$"X-RateLimit-Limit{suffix}"] =
                        bucket.Limit.ToString(CultureInfo.InvariantCulture);
                    context.Response.Headers[$"X-RateLimit-Remaining{suffix}"] =
                        Math.Max(0, bucket.Limit - result.TotalHits).ToString(CultureInfo.InvariantCulture);
                    context.Response.Headers[$"X-RateLimit-Reset{suffix}"] =
                        result.TimeToExpireSeconds.ToString(CultureInfo.InvariantCulture);
                }
            }

            await next(context);
        });
    }

    /// <summary>Per-endpoint counter key (Node keyed per controller class + handler).</summary>
    private static string EndpointKey(HttpContext context, Endpoint endpoint) =>
        endpoint is RouteEndpoint route
            ? $"{context.Request.Method} {route.RoutePattern.RawText}"
            : endpoint.DisplayName ?? context.Request.Path.ToString();

    private static string ClientKey(HttpContext context)
    {
        var forwarded = context.Request.Headers["X-Forwarded-For"].ToString();
        if (forwarded.Length > 0)
        {
            var entries = forwarded.Split(',');
            var last = entries[^1].Trim();
            if (last.Length > 0)
            {
                return last;
            }
        }

        return context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    }
}
