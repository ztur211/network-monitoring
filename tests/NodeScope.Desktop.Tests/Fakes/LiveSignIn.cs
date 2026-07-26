using System.Collections.Concurrent;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;

namespace NodeScope.Desktop.Tests.Fakes;

/// <summary>
/// Signs into a live appliance once per (server, account) and shares the session token
/// across the E2E suites. Against a production appliance every credential post lands in
/// one strict auth bucket (5 writes per client per 15 minutes), so the seeded owner signs
/// in a single time; each test then vaults the shared token and takes the flow's restore
/// path (users/me, unthrottled) - exactly what a returning desktop user exercises. The
/// separate auth E2E keeps the fresh sign-up/sign-in/sign-out budget to itself.
/// </summary>
internal static class LiveSignIn
{
    private static readonly ApplianceClientFactory Factory = new();

    private static readonly ConcurrentDictionary<string, Lazy<Task<string>>> Sessions =
        new(StringComparer.Ordinal);

    /// <summary>Vaults the shared session token and restores <paramref name="flow"/> onto it.</summary>
    public static async Task RestoreAsync(
        DesktopAuthFlow flow, ITokenVault vault, Uri server, string email, string password)
    {
        vault.Save(new VaultEntry(server, await TokenAsync(server, email, password)));
        await flow.RestoreAsync(CancellationToken.None);
    }

    private static async Task<string> TokenAsync(Uri server, string email, string password)
    {
        var key = $"{server}|{email}";
        var pending = Sessions.GetOrAdd(
            key,
            _ => new Lazy<Task<string>>(
                () => SignInOnceAsync(server, email, password),
                LazyThreadSafetyMode.ExecutionAndPublication));
        try
        {
            return await pending.Value;
        }
        catch
        {
            // A failed sign-in must not poison the cache for the whole run.
            if (Sessions.TryGetValue(key, out var current) && ReferenceEquals(current, pending))
            {
                Sessions.TryRemove(key, out _);
            }

            throw;
        }
    }

    private static async Task<string> SignInOnceAsync(Uri server, string email, string password)
    {
        // The shared factory's connection pool lives for the test process; per-call
        // clients only borrow it.
        using var client = Factory.Create(server);
        return await client.SignInAsync(email, password, CancellationToken.None);
    }
}
