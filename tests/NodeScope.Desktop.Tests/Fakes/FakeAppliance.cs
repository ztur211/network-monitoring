using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;

namespace NodeScope.Desktop.Tests.Fakes;

/// <summary>An in-memory appliance: scripted responses, recorded requests.</summary>
internal sealed class FakeApplianceClient(Uri baseUrl) : IApplianceClient
{
    public Uri BaseUrl { get; } = baseUrl;

    public string TokenToReturn { get; set; } = "session-token-1";

    public CurrentUser UserToReturn { get; set; } = new("user-1", "owner@acme.test", "Owner");

    public Exception? ExchangeFailure { get; set; }

    public Exception? CurrentUserFailure { get; set; }

    public string? LastExchangedCode { get; private set; }

    public string? LastVerifier { get; private set; }

    public string? LastBearerToken { get; private set; }

    public string? RevokedToken { get; private set; }

    public void Dispose()
    {
    }

    public Task<string> ExchangeDesktopCodeAsync(string code, string codeVerifier, CancellationToken cancellationToken)
    {
        LastExchangedCode = code;
        LastVerifier = codeVerifier;
        return ExchangeFailure is null ? Task.FromResult(TokenToReturn) : Task.FromException<string>(ExchangeFailure);
    }

    public Task<CurrentUser> GetCurrentUserAsync(string bearerToken, CancellationToken cancellationToken)
    {
        LastBearerToken = bearerToken;
        return CurrentUserFailure is null
            ? Task.FromResult(UserToReturn)
            : Task.FromException<CurrentUser>(CurrentUserFailure);
    }

    public Task RevokeAsync(string bearerToken, CancellationToken cancellationToken)
    {
        RevokedToken = bearerToken;
        return Task.CompletedTask;
    }
}

internal sealed class FakeApplianceClientFactory : IApplianceClientFactory
{
    public List<FakeApplianceClient> Created { get; } = [];

    public IApplianceClient Create(Uri baseUrl)
    {
        var client = new FakeApplianceClient(baseUrl);
        Created.Add(client);
        return client;
    }

    public FakeApplianceClient Last => Created[^1];
}

/// <summary>Records the authorize URL instead of opening a browser.</summary>
internal sealed class FakeBrowserLauncher : IBrowserLauncher
{
    public Uri? LastOpened { get; private set; }

    public void Open(Uri url) => LastOpened = url;
}

/// <summary>An in-memory vault.</summary>
internal sealed class InMemoryTokenVault : ITokenVault
{
    public VaultEntry? Entry { get; set; }

    public VaultEntry? Load() => Entry;

    public void Save(VaultEntry entry) => Entry = entry;

    public void Clear() => Entry = null;
}
