using NodeScope.Contracts.Monitoring;
using Xunit;

namespace NodeScope.Agent.Tests;

/// <summary>
/// Live SNMPv3 AES-256 crypto-matrix tests against a real net-snmp daemon - the gear
/// test left open by Decision 12: which key-extension variant AES-256 privacy speaks
/// when the auth digest is shorter than 32 bytes. net-snmp implements both published
/// variants, so a daemon configured with one user per (auth, variant) pair is the
/// reference instrument.
///
/// What these tests pin down: the product's "AES256" means the Reeder/Cisco extension
/// (net-snmp's "AES-256-C"), the one real gear predominantly implements, via our own
/// <see cref="Aes256PrivacyProvider"/> - SharpSnmpLib's provider gets MD5-auth keys
/// wrong (see that class's doc). The explicit net-snmp variant spellings stay honest:
/// "AES256B" is Blumenthal, "AES256R" is Reeder. With SHA-256 auth the digest is
/// already 32 bytes, no extension runs, and the variants coincide.
///
/// Skipped unless NODESCOPE_SNMPD_HOST is set to the daemon's IP address. Start one
/// with the required users via: scripts/run-snmpd-aes.sh
/// </summary>
public sealed class SnmpV3AesVariantTests
{
    private const string SysUpTimeOid = "1.3.6.1.2.1.1.3.0";

    // The daemon-side variant is encoded in the user name: *c = AES-256-C
    // (Cisco/Reeder key extension), *b = AES-256 (Blumenthal). The auth protocol
    // spellings are the DB-enum values the API sends verbatim.
    [SnmpdTheory]
    [InlineData("md5c", "MD5")]
    [InlineData("sha1c", "SHA")]
    [InlineData("sha256c", "SHA256")]
    [InlineData("sha256b", "SHA256")] // 32-byte digest: no extension, variants coincide
    public async Task Aes256_speaks_the_reeder_key_extension(string user, string authProtocol)
    {
        var values = await GetSysUpTimeAsync(user, authProtocol, "AES256");

        Assert.Contains(SysUpTimeOid, values.Keys);
    }

    [SnmpdTheory]
    [InlineData("md5b", "MD5")]
    [InlineData("sha1b", "SHA")]
    [InlineData("sha256b", "SHA256")]
    public async Task Aes256b_speaks_the_blumenthal_key_extension(string user, string authProtocol)
    {
        var values = await GetSysUpTimeAsync(user, authProtocol, "AES256B");

        Assert.Contains(SysUpTimeOid, values.Keys);
    }

    [SnmpdTheory]
    [InlineData("md5b", "MD5")]
    [InlineData("sha1b", "SHA")]
    public async Task Aes256_does_not_speak_the_blumenthal_key_extension(string user, string authProtocol)
    {
        // A key-extension mismatch surfaces as an undecryptable request: the daemon
        // answers with a usmStatsDecryptionErrors report (or nothing), never with the
        // requested value. Accept either observable - what matters is that sysUpTime
        // is unreachable, which is what the collector's fault isolation reacts to.
        IReadOnlyDictionary<string, double>? values = null;
        var exception = await Record.ExceptionAsync(async () =>
            values = await GetSysUpTimeAsync(user, authProtocol, "AES256"));

        Assert.True(
            exception is not null || !values!.ContainsKey(SysUpTimeOid),
            $"user '{user}' answered a Reeder-extended request - the pinned variant finding no longer holds");
    }

    private static async Task<IReadOnlyDictionary<string, double>> GetSysUpTimeAsync(
        string user, string authProtocol, string privProtocol)
    {
        var host = Environment.GetEnvironmentVariable("NODESCOPE_SNMPD_HOST")!;
        var target = new SnmpTargetDto
        {
            Version = "V3",
            SecurityName = user,
            SecurityLevel = "AUTH_PRIV",
            AuthProtocol = authProtocol,
            AuthKey = "authpass12",
            PrivProtocol = privProtocol,
            PrivKey = "privpass12",
            Oids = [],
            InterfaceMetrics = false,
        };
        using var session = new SharpSnmpSession(target, host);
        return await session.GetAsync([SysUpTimeOid], CancellationToken.None);
    }
}

/// <summary>
/// A theory that runs only when a live net-snmp daemon is configured; otherwise the
/// test reports as skipped rather than silently passing.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class SnmpdTheoryAttribute : TheoryAttribute
{
    public SnmpdTheoryAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("NODESCOPE_SNMPD_HOST")))
        {
            Skip = "Set NODESCOPE_SNMPD_HOST to a daemon started by scripts/run-snmpd-aes.sh";
        }
    }
}
