// Composition root for the NodeScope API.
//
// Decision 6: minimal APIs, no ControllerBase anywhere. Each module exposes exactly
// one registration extension method and one endpoint-mapping extension method, and
// this file composes them. Business logic does not live here.
//
// The module calls are absent rather than stubbed: no module has been ported yet
// (sequencing step 4), and an empty MapIdentityEndpoints() would make the skeleton
// look further along than it is. They get added as each module lands.

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHealthChecks();

var app = builder.Build();

// Liveness only. The readiness probe grows real checks (Postgres, Redis, MinIO)
// alongside the modules that own those dependencies.
app.MapHealthChecks("/health");

await app.RunAsync().ConfigureAwait(false);

// No `public partial class Program` declaration here on purpose. The contract suite
// is black-box over BASE_URL (Decision 4) and so never needs the host type. When the
// module-level integration tests arrive (Decision 18) and want WebApplicationFactory,
// expose it with InternalsVisibleTo rather than by making Program public - CA1515 is
// correct that an application's types should stay internal.
