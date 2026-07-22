using System.Net;
using System.Net.Http.Json;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

namespace NodeScope.Agent;

/// <summary>The appliance's <c>/agent/manifest.json</c>: newest version plus per-platform artifacts.</summary>
internal sealed record UpdateManifest
{
    public string? Version { get; init; }

    public IReadOnlyDictionary<string, UpdateManifestEntry>? Binaries { get; init; }
}

internal sealed record UpdateManifestEntry
{
    /// <summary>File name relative to the manifest URL.</summary>
    public required string File { get; init; }

    public required string Sha256 { get; init; }

    /// <summary>Base64 ECDSA P-256/SHA-256 signature (DER) over the binary bytes.</summary>
    public required string Signature { get; init; }
}

internal static class UpdateVerifier
{
    public static bool Sha256Matches(byte[] payload, string expectedHex) =>
        string.Equals(Convert.ToHexString(SHA256.HashData(payload)), expectedHex, StringComparison.OrdinalIgnoreCase);

    public static bool SignatureValid(byte[] payload, string base64Signature, string publicKeyPem)
    {
        byte[] signature;
        try
        {
            signature = Convert.FromBase64String(base64Signature);
        }
        catch (FormatException)
        {
            return false;
        }

        using var ecdsa = ECDsa.Create();
        ecdsa.ImportFromPem(publicKeyPem);
        return ecdsa.VerifyData(payload, signature, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence);
    }
}

/// <summary>
/// Manifest-driven self-update (Decision 13). The agent polls the static manifest its own
/// appliance serves, and on a strictly newer version downloads the platform binary, verifies
/// checksum and publisher signature, swaps itself on disk, and cancels the daemon so the
/// service manager (Restart=always) brings the new binary up. Update is a remote-code-execution
/// channel by construction, so the signature check pins a publisher key baked in here - a
/// compromised appliance must not be able to push code to its fleet - and the strictly-greater
/// version rule blocks replaying old signed binaries.
/// </summary>
internal sealed class SelfUpdater(
    HttpClient http,
    Uri manifestUri,
    string currentVersion,
    string executablePath,
    string? platform = null,
    string? publicKeyPem = null,
    Action<string>? log = null)
{
    /// <summary>
    /// The NodeScope agent publisher key. The private half lives only on the release machine
    /// (~/.nodescope/agent-signing.key); regenerating it orphans every deployed agent.
    /// </summary>
    internal const string PublisherPublicKeyPem = """
        -----BEGIN PUBLIC KEY-----
        MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERu82LnwHi9fVXevrloVhU73HeZcG
        O8vPFg8UsNyWcytI10CtnPz/KvlUPRsRdPU+4U5PMgnguurkmBI9Xkwlag==
        -----END PUBLIC KEY-----
        """;

    private readonly string _platform = platform ?? PlatformKey();
    private readonly string _publicKeyPem = publicKeyPem ?? PublisherPublicKeyPem;
    private readonly Action<string> _log = log ?? (static message => Console.Error.WriteLine(message));

    /// <summary>The manifest lives at the appliance origin, outside the API path: <c>/agent/manifest.json</c>.</summary>
    public static Uri DeriveManifestUri(string apiUrl)
    {
        var api = new Uri(apiUrl, UriKind.Absolute);
        return new Uri(api.GetLeftPart(UriPartial.Authority) + "/agent/manifest.json");
    }

    /// <summary>Manifest key for this host, matching the .NET runtime identifiers the release script publishes.</summary>
    internal static string PlatformKey()
    {
        var os = OperatingSystem.IsWindows() ? "win" : OperatingSystem.IsMacOS() ? "osx" : "linux";
        var arch = RuntimeInformation.ProcessArchitecture switch
        {
            Architecture.X64 => "x64",
            Architecture.Arm64 => "arm64",
            // An arch we do not release for; no manifest entry will match, so no update.
            _ => "unsupported",
        };
        return $"{os}-{arch}";
    }

    /// <summary>
    /// Polls until an update installs (cancels <paramref name="shutdown"/>, returns true) or the
    /// daemon shuts down (returns false). The first check is jittered across a full interval so
    /// a fleet sharing one appliance does not check in lockstep.
    /// </summary>
    public async Task<bool> RunLoopAsync(TimeSpan interval, CancellationTokenSource shutdown)
    {
        try
        {
            await Task.Delay(interval * (RandomNumberGenerator.GetInt32(0, 1000) / 1000.0), shutdown.Token);
            while (true)
            {
                try
                {
                    if (await CheckOnceAsync(shutdown.Token))
                    {
                        await shutdown.CancelAsync();
                        return true;
                    }
                }
                catch (OperationCanceledException) when (shutdown.IsCancellationRequested)
                {
                    return false;
                }
#pragma warning disable CA1031 // A failed check must never kill the daemon; the next tick retries.
                catch (Exception e)
#pragma warning restore CA1031
                {
                    _log($"[agent] update check failed: {e.Message}");
                }

                await Task.Delay(interval, shutdown.Token);
            }
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    /// <summary>One poll: fetch manifest, compare versions, download + verify + swap. True if swapped.</summary>
    public async Task<bool> CheckOnceAsync(CancellationToken cancellationToken)
    {
        using var response = await http.GetAsync(manifestUri, cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            // No update channel on this server (e.g. dev API without the appliance front) - stay quiet.
            return false;
        }

        if (!response.IsSuccessStatusCode)
        {
            _log($"[agent] update manifest fetch failed: {(int)response.StatusCode}");
            return false;
        }

        UpdateManifest? manifest;
        try
        {
            manifest = await response.Content.ReadFromJsonAsync(
                AgentJsonContext.Default.UpdateManifest, cancellationToken);
        }
        catch (Exception e) when (e is JsonException or NotSupportedException)
        {
            // NotSupportedException covers a non-JSON content type - e.g. a misconfigured server
            // answering the manifest path with the SPA's index.html.
            _log("[agent] update manifest is not valid JSON - skipping");
            return false;
        }

        if (manifest?.Version is null
            || !Version.TryParse(manifest.Version, out var offered)
            || !Version.TryParse(currentVersion, out var running)
            || offered <= running)
        {
            return false;
        }

        if (manifest.Binaries is null || !manifest.Binaries.TryGetValue(_platform, out var entry))
        {
            _log($"[agent] update {manifest.Version} has no binary for {_platform} - skipping");
            return false;
        }

        var payload = await http.GetByteArrayAsync(new Uri(manifestUri, entry.File), cancellationToken);
        if (!UpdateVerifier.Sha256Matches(payload, entry.Sha256)
            || !UpdateVerifier.SignatureValid(payload, entry.Signature, _publicKeyPem))
        {
            _log($"[agent] update {manifest.Version} failed checksum/signature verification - refusing to install");
            return false;
        }

        Install(payload);
        _log($"[agent] updated {currentVersion} -> {manifest.Version}; exiting so the service manager starts the new binary");
        return true;
    }

    /// <summary>
    /// Stage-then-rename swap. The staged file sits next to the executable (same filesystem, so
    /// the final rename is atomic), the running binary is kept as .old for manual rollback, and
    /// both Linux and Windows permit renaming a running executable even though Windows forbids
    /// overwriting one.
    /// </summary>
    private void Install(byte[] payload)
    {
        var staged = executablePath + ".update";
        File.WriteAllBytes(staged, payload);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(staged,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                | UnixFileMode.GroupRead | UnixFileMode.GroupExecute
                | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
        }

        var previous = executablePath + ".old";
        File.Delete(previous);
        File.Move(executablePath, previous);
        try
        {
            File.Move(staged, executablePath);
        }
        catch
        {
            File.Move(previous, executablePath);
            throw;
        }
    }
}
