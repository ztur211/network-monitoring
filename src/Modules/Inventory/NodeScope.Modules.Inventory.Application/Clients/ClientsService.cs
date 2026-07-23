using System.Text.RegularExpressions;

namespace NodeScope.Modules.Inventory.Application.Clients;

/// <summary>The latest browser-collector reading for a user.</summary>
public sealed record MetricsDto(
    double? BandwidthDown,
    double? BandwidthUp,
    double? Latency,
    string? ConnectionQuality,
    DateTime Timestamp);

/// <summary>The calling client as the API sees it.</summary>
public sealed record CurrentDeviceDto(string UserAgent, string? Platform, MetricsDto? Metrics);

/// <summary>The desktop-agent availability notice (fixed until the agent ships to end users).</summary>
public sealed record AgentStatusDto(bool Available, string Message);

public sealed record ClientsDto(CurrentDeviceDto CurrentDevice, AgentStatusDto AgentStatus);

/// <summary>Reader for the browser collector's <c>DeviceMetric</c> rows.</summary>
public interface IUserMetricsRepository
{
    /// <summary>The user's most recent reading in this org, or null when they have none.</summary>
    public Task<MetricsDto?> LatestForUserAsync(
        string organizationId,
        string userId,
        CancellationToken cancellationToken);
}

/// <summary>The connected-clients read (Node's <c>ClientsService</c>).</summary>
public sealed partial class ClientsService
{
    private const string AgentUnavailableMessage =
        "Desktop Agent coming post-MVP (Priority 1). Once available, it will provide 24/7 network "
        + "monitoring, active device discovery, and latency pinging - even when NodeScope is not open.";

    private readonly IUserMetricsRepository _metrics;

    public ClientsService(IUserMetricsRepository metrics)
    {
        _metrics = metrics;
    }

    public async Task<ClientsDto> GetAsync(
        string organizationId,
        string userId,
        string userAgent,
        CancellationToken cancellationToken)
    {
        var metrics = await _metrics.LatestForUserAsync(organizationId, userId, cancellationToken);
        return new ClientsDto(
            new CurrentDeviceDto(userAgent, ParsePlatform(userAgent), metrics),
            new AgentStatusDto(false, AgentUnavailableMessage));
    }

    private static string? ParsePlatform(string userAgent)
    {
        if (Windows().IsMatch(userAgent))
        {
            return "Windows";
        }

        if (MacOs().IsMatch(userAgent))
        {
            return "macOS";
        }

        if (Linux().IsMatch(userAgent))
        {
            return "Linux";
        }

        if (Android().IsMatch(userAgent))
        {
            return "Android";
        }

        return Ios().IsMatch(userAgent) ? "iOS" : null;
    }

    [GeneratedRegex("windows", RegexOptions.IgnoreCase)]
    private static partial Regex Windows();

    [GeneratedRegex("mac os x", RegexOptions.IgnoreCase)]
    private static partial Regex MacOs();

    [GeneratedRegex("linux", RegexOptions.IgnoreCase)]
    private static partial Regex Linux();

    [GeneratedRegex("android", RegexOptions.IgnoreCase)]
    private static partial Regex Android();

    [GeneratedRegex("iphone|ipad|ipod", RegexOptions.IgnoreCase)]
    private static partial Regex Ios();
}
