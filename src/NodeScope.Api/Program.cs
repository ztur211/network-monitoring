// Composition root for the NodeScope API.
//
// Decision 6: minimal APIs, no ControllerBase anywhere. Each module exposes exactly
// one registration extension method and one endpoint-mapping extension method, and
// this file composes them. Business logic does not live here.

using NodeScope.Api;
using NodeScope.Modules.Alerting.Infrastructure;
using NodeScope.Modules.Assistant.Infrastructure;
using NodeScope.Modules.Identity.Infrastructure;
using NodeScope.Modules.Inventory.Infrastructure;
using NodeScope.Modules.Monitoring.Infrastructure;
using NodeScope.Modules.Realtime.Infrastructure;
using NodeScope.Platform;
using NodeScope.Platform.Http;

var builder = WebApplication.CreateBuilder(args);

builder.Services.ConfigureHttpJsonOptions(options =>
    // DTOs carry plain DateTime properties; the converter makes them serialize exactly
    // like a JS Date in JSON.stringify (UTC, millisecond precision, Z suffix).
    options.SerializerOptions.Converters.Add(new JsDateTimeConverter()));

// Body-binding failures (unparseable JSON, wrong item types) must reach the exception
// middleware and come back as the GEN_001 envelope; the framework's silent empty 400
// (the non-Development default) is not part of the contract.
builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(options =>
    options.ThrowOnBadRequest = true);

builder.Services.AddHealthChecks();

// The agent gzips large ingest batches; body-parser inflated them transparently in Node.
builder.Services.AddRequestDecompression();

builder.Services.AddNodeScopePlatform(builder.Configuration);
builder.Services.AddIdentityModule(builder.Configuration);
builder.Services.AddInventoryModule(builder.Configuration);
builder.Services.AddMonitoringModule(builder.Configuration);
builder.Services.AddRealtimeModule(builder.Configuration);
builder.Services.AddAssistantModule(builder.Configuration);
builder.Services.AddAlertingModule(builder.Configuration);

var app = builder.Build();

// Decision 11/20: this host owns the schema (Decision 5, EF migrations). Pending
// migrations are applied before the app serves traffic; a database created by the
// Node stack is baselined first, so Initial is stamped rather than re-run.
await app.Services.MigrateNodeScopeDatabaseAsync().ConfigureAwait(false);

app.UseMiddleware<ApiExceptionMiddleware>();
app.UseJsonBodyLimit();
app.UseRequestDecompression();
app.UseAuditContext();
app.UseAuthentication();
app.UseAuthorization();
// After authorization, matching the Nest guard order (AuthGuard before ThrottlerGuard):
// a rejected credential never consumes rate-limit budget.
app.UseThrottling();

// Bare /health is this host's own liveness probe; /api/health is the product's readiness
// endpoint (HealthEndpoints), which the contract fixture gates suite startup on.
app.MapHealthChecks("/health").SkipThrottle();
app.MapApiHealthEndpoint();

app.MapBandwidthEndpoints();
app.MapInventoryEndpoints();
app.MapMonitoringEndpoints();
app.MapRealtimeEndpoints();
app.MapAssistantEndpoints();
app.MapAlertingEndpoints();
app.MapIdentityEndpoints();

// Seed mode (`dotnet NodeScope.Api.dll seed`): the dev/demo dataset instead of serving.
// Replaces the Node stack's `npm run db:seed` + `scripts/load-sample-model.mjs`.
if (args.Contains("seed", StringComparer.Ordinal))
{
    await DemoSeeder.RunAsync(app).ConfigureAwait(false);
    return;
}

await app.RunAsync().ConfigureAwait(false);

// No `public partial class Program` declaration here on purpose. The contract suite
// is black-box over BASE_URL (Decision 4) and so never needs the host type. When the
// module-level integration tests arrive (Decision 18) and want WebApplicationFactory,
// expose it with InternalsVisibleTo rather than by making Program public - CA1515 is
// correct that an application's types should stay internal.
