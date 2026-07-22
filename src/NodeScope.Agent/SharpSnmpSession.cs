using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Net;
using Lextm.SharpSnmpLib;
using Lextm.SharpSnmpLib.Messaging;
using Lextm.SharpSnmpLib.Security;

namespace NodeScope.Agent;

/// <summary>
/// The real <see cref="ISnmpSession"/> backed by SharpSnmpLib. Not unit-tested - the
/// collector is tested via a fake session; this adapter's runtime correctness is verified
/// by the spike against net-snmp and by gear testing.
///
/// The IL2026 suppressions are justified by the csproj rooting the whole SharpSnmpLib
/// assembly via TrimmerRootAssembly: nothing the library could reach for is ever trimmed,
/// so its RequiresUnreferencedCode annotations cannot bite. Verified end-to-end by the
/// 2026-07-21 NativeAOT spike (Decision 12).
/// </summary>
internal sealed class SharpSnmpSession : ISnmpSession
{
    private const string TrimJustification =
        "SharpSnmpLib is fully rooted via TrimmerRootAssembly; AOT behaviour verified by the Decision 12 spike.";

    /// <summary>One UDP exchange's deadline. The Node agent inherited net-snmp's 5 s default.</summary>
    private const int OperationTimeoutMs = 5_000;

    private const int WalkMaxRepetitions = 10;

    private readonly IPEndPoint _endpoint;
    private readonly bool _v3;
    private readonly OctetString _community;
    private readonly OctetString _userName;
    private readonly IPrivacyProvider? _privacy;
    private ISnmpMessage? _report;

    public SharpSnmpSession(NodeScope.Contracts.Monitoring.SnmpTargetDto target, string host)
    {
        _endpoint = new IPEndPoint(IPAddress.Parse(host), 161);
        _v3 = string.Equals(target.Version, "V3", StringComparison.OrdinalIgnoreCase);
        _community = new OctetString(target.Community ?? "public");
        _userName = new OctetString(target.SecurityName ?? string.Empty);
        _privacy = _v3 ? BuildPrivacy(target) : null;
    }

    [UnconditionalSuppressMessage("Trimming", "IL2026", Justification = TrimJustification)]
    public async Task<IReadOnlyDictionary<string, double>> GetAsync(
        IReadOnlyList<string> oids, CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(OperationTimeoutMs);
        var variables = oids.Select(oid => new Variable(new ObjectIdentifier(oid))).ToList();

        IList<Variable> result;
        if (_v3)
        {
            var report = await ReportAsync(cts.Token);
            var request = new GetRequestMessage(
                VersionCode.V3,
                Messenger.NextMessageId,
                Messenger.NextRequestId,
                _userName,
                OctetString.Empty,
                variables,
                _privacy!, // always built when _v3 (see constructor)
                Messenger.MaxMessageSize,
                report);
            var reply = await request.GetResponseAsync(_endpoint, cts.Token);
            if (reply.Pdu().ErrorStatus.ToErrorCode() != ErrorCode.NoError)
            {
                throw new InvalidOperationException($"SNMP v3 GET failed: {reply.Pdu().ErrorStatus}");
            }

            result = reply.Pdu().Variables;
        }
        else
        {
            result = await Messenger.GetAsync(VersionCode.V2, _endpoint, _community, variables, cts.Token);
        }

        var values = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var variable in result)
        {
            if (ToNumber(variable.Data) is { } number)
            {
                values[variable.Id.ToString()] = number;
            }
        }

        return values;
    }

    [UnconditionalSuppressMessage("Trimming", "IL2026", Justification = TrimJustification)]
    public async Task<IReadOnlyDictionary<string, double>> WalkColumnAsync(
        string oid, CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(OperationTimeoutMs);
        var list = new List<Variable>();
        if (_v3)
        {
            var report = await ReportAsync(cts.Token);
            await Messenger.BulkWalkAsync(
                VersionCode.V3, _endpoint, _userName, OctetString.Empty, new ObjectIdentifier(oid),
                list, WalkMaxRepetitions, WalkMode.WithinSubtree, _privacy!, report, cts.Token);
        }
        else
        {
            // privacy/report are v3-only; the library reads neither on the v2c path (verified by
            // the Decision 12 spike, which walked exactly this way against net-snmp).
            await Messenger.BulkWalkAsync(
                VersionCode.V2, _endpoint, _community, OctetString.Empty, new ObjectIdentifier(oid),
                list, WalkMaxRepetitions, WalkMode.WithinSubtree, null!, null!, cts.Token);
        }

        var values = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var variable in list)
        {
            if (ToNumber(variable.Data) is { } number)
            {
                values[LastOidSegment(variable.Id.ToString())] = number;
            }
        }

        return values;
    }

    public void Dispose()
    {
        // Messenger's async API is connectionless (one UDP socket per exchange); there is no
        // session-scoped resource to release. The interface keeps disposal in the contract so
        // a future connection-reusing implementation needs no collector change.
    }

    [UnconditionalSuppressMessage("Trimming", "IL2026", Justification = TrimJustification)]
    private async Task<ISnmpMessage> ReportAsync(CancellationToken cancellationToken)
    {
        // The discovery exchange (engine id/boots/time) is per-target state; one per session
        // is enough for the handful of requests a poll cycle sends.
        if (_report is null)
        {
            var discovery = Messenger.GetNextDiscovery(SnmpType.GetRequestPdu);
            _report = await discovery.GetResponseAsync(_endpoint, cancellationToken);
        }

        return _report;
    }

    private static IPrivacyProvider BuildPrivacy(NodeScope.Contracts.Monitoring.SnmpTargetDto target)
    {
        var auth = BuildAuthentication(target.AuthProtocol, target.AuthKey ?? string.Empty);
        // The API sends the DB enum verbatim: AUTH_PRIV / AUTH_NO_PRIV / NO_AUTH_NO_PRIV.
        // Normalising the separators away also accepts the camel-case spellings net-snmp
        // used. (The Node agent matched only the latter, so AUTH_PRIV silently degraded to
        // noAuthNoPriv - a real bug this port fixes; see the decision log.)
        var level = (target.SecurityLevel ?? string.Empty)
            .Replace("_", string.Empty, StringComparison.Ordinal)
            .ToUpperInvariant();
        return level switch
        {
            "AUTHPRIV" or "AUTHPRIVACY" => BuildPrivacyProvider(target.PrivProtocol, target.PrivKey ?? string.Empty, auth),
            "AUTHNOPRIV" or "AUTHNOPRIVACY" => new DefaultPrivacyProvider(auth),
            _ => DefaultPrivacyProvider.DefaultPair,
        };
    }

    private static IAuthenticationProvider BuildAuthentication(string? protocol, string key)
    {
        var phrase = new OctetString(key);
        return (protocol ?? string.Empty).ToUpperInvariant() switch
        {
#pragma warning disable CS0618 // MD5/SHA-1 are obsolete-but-supported: the installed base of gear still speaks them.
            "MD5" => new MD5AuthenticationProvider(phrase),
            "SHA" => new SHA1AuthenticationProvider(phrase),
#pragma warning restore CS0618
            "SHA256" => new SHA256AuthenticationProvider(phrase),
            "SHA384" => new SHA384AuthenticationProvider(phrase),
            "SHA512" => new SHA512AuthenticationProvider(phrase),
            // SharpSnmpLib (and .NET itself) has no SHA-224. Throwing lands in the collector's
            // per-device fault isolation: same observable outcome as the Node agent's auth
            // failure for a protocol the library cannot speak.
            "SHA224" => throw new NotSupportedException("SNMPv3 SHA-224 authentication is not supported"),
            _ => DefaultAuthenticationProvider.Instance,
        };
    }

    private static IPrivacyProvider BuildPrivacyProvider(string? protocol, string key, IAuthenticationProvider auth)
    {
        var phrase = new OctetString(key);
        return (protocol ?? string.Empty).ToUpperInvariant() switch
        {
#pragma warning disable CS0618 // DES is obsolete-but-supported, as above.
            "DES" => new DESPrivacyProvider(phrase, auth),
#pragma warning restore CS0618
            "AES" or "AES128" => new AESPrivacyProvider(phrase, auth),
            "AES192" => new AES192PrivacyProvider(phrase, auth),
            "AES256" or "AES256B" or "AES256R" => new AES256PrivacyProvider(phrase, auth),
            _ => new DefaultPrivacyProvider(auth),
        };
    }

    private static double? ToNumber(ISnmpData data) => data switch
    {
        Integer32 value => value.ToInt32(),
        Counter32 value => value.ToUInt32(),
        Gauge32 value => value.ToUInt32(),
        TimeTicks value => value.ToUInt32(),
        // Precision loss above 2^53 is possible and acceptable for metric purposes.
        Counter64 value => value.ToUInt64(),
        OctetString value when double.TryParse(
            value.ToString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) => parsed,
        _ => null,
    };

    private static string LastOidSegment(string oid)
    {
        var dot = oid.LastIndexOf('.');
        return dot >= 0 ? oid[(dot + 1)..] : oid;
    }
}
