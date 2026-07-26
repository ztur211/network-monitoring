namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// One HTTP client, shared by every contract test, pointed at <c>{BASE_URL}/api/</c>.
/// On start it probes <c>/api/health</c> so an unreachable target fails once with a
/// clear message rather than every test drowning in connection errors.
/// </summary>
public sealed class ContractApiFixture : IAsyncLifetime, IDisposable
{
    // UseCookies=false is load-bearing: the suite sets auth explicitly per request,
    // so an automatic cookie jar would leak a session from one test into the next.
    private readonly SocketsHttpHandler _handler;
    private readonly HttpClient _http;

    // Super-admin is a per-target capability, not per-test state, and bootstrapping it
    // costs a sign-up, a DB write, and a sign-in. Mint it once and share it across the
    // whole collection. The lock is belt-and-suspenders: a collection's tests run
    // serially, but this keeps the lazy init correct if that ever changes.
    private readonly SemaphoreSlim _superAdminLock = new(1, 1);
    private UserSession? _superAdmin;

    public ContractApiFixture()
    {
        _handler = new SocketsHttpHandler { UseCookies = false };
        _http = new HttpClient(_handler, disposeHandler: false)
        {
            BaseAddress = new Uri(TestConfig.BaseUrl + "/api/"),
            Timeout = TimeSpan.FromSeconds(30),
        };
        Api = new ApiClient(_http);
    }

    /// <summary>The black-box client under test.</summary>
    public ApiClient Api { get; }

    /// <summary>
    /// The run's shared super-admin session, bootstrapped on first use. Tests that
    /// only need an isolated org should prefer <see cref="ProvisionOrgAsync"/>.
    /// </summary>
    public async Task<UserSession> SuperAdminAsync(CancellationToken cancellationToken = default)
    {
        await _superAdminLock.WaitAsync(cancellationToken);
        try
        {
            _superAdmin ??= await OrgProvisioning.BootstrapSuperAdminAsync(Api, cancellationToken);
        }
        finally
        {
            _superAdminLock.Release();
        }

        return _superAdmin;
    }

    /// <summary>
    /// Provisions a fresh, isolated organization with a brand-new OWNER, using the
    /// shared super-admin. The single call the org-scoped tests reach for.
    /// </summary>
    public async Task<ProvisionedOrg> ProvisionOrgAsync(string? name = null, CancellationToken cancellationToken = default)
    {
        var superAdmin = await SuperAdminAsync(cancellationToken);
        return await OrgProvisioning.ProvisionOrgAsync(Api, superAdmin, name, cancellationToken);
    }

    public async Task InitializeAsync()
    {
        try
        {
            var response = await Api.GetAsync("health");
            if (!response.IsSuccess)
            {
                throw new InvalidOperationException(
                    $"Contract target at {TestConfig.BaseUrl} answered /api/health with {response.StatusCode}. " +
                    "Expected a 2xx from a running NodeScope API.");
            }
        }
        catch (HttpRequestException ex)
        {
            throw new InvalidOperationException(Unreachable(ex), ex);
        }
        catch (TaskCanceledException ex)
        {
            throw new InvalidOperationException(Unreachable(ex), ex);
        }
    }

    public Task DisposeAsync() => Task.CompletedTask;

    public void Dispose()
    {
        _superAdminLock.Dispose();
        _http.Dispose();
        _handler.Dispose();
    }

    private static string Unreachable(Exception ex) =>
        $"Contract suite could not reach the API at {TestConfig.BaseUrl}. Start the NodeScope API " +
        $"(scripts/run-csharp-host.sh targets the disposable test stack) or set " +
        $"{TestConfig.BaseUrlVariable} to a running instance. Underlying error: {ex.Message}";
}

/// <summary>
/// Binds <see cref="ContractApiFixture"/> to a single xUnit collection so the health
/// probe and HTTP client are created once for the whole run.
/// </summary>
[CollectionDefinition(Name)]
public sealed class ContractSuite : ICollectionFixture<ContractApiFixture>
{
    public const string Name = "Contract";
}
