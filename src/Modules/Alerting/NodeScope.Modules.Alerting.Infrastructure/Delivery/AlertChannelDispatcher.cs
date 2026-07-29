using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using NodeScope.Contracts.Realtime;
using NodeScope.Modules.Alerting.Application;
using NodeScope.Modules.Alerting.Domain;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Alerting.Infrastructure.Delivery;

internal sealed class AlertChannelDispatcher : IAlertChannelDispatcher
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IHttpClientFactory _httpClients;
    private readonly IRealtimeService _realtime;
    private readonly ISecretCipher _cipher;

    public AlertChannelDispatcher(
        IHttpClientFactory httpClients,
        IRealtimeService realtime,
        ISecretCipher cipher)
    {
        _httpClients = httpClients;
        _realtime = realtime;
        _cipher = cipher;
    }

    public Task DispatchAsync(
        AlertChannelRecord channel,
        AlertEventRecord alertEvent,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(channel);
        ArgumentNullException.ThrowIfNull(alertEvent);
        return channel.Type switch
        {
            AlertChannelType.Webhook => SendWebhookAsync(channel, alertEvent, cancellationToken),
            AlertChannelType.Email => SendEmailAsync(channel, alertEvent, cancellationToken),
            AlertChannelType.Inapp => SendInAppAsync(alertEvent, cancellationToken),
            _ => throw new InvalidOperationException($"Unsupported alert channel {channel.Type}"),
        };
    }

    private async Task SendWebhookAsync(
        AlertChannelRecord channel,
        AlertEventRecord alertEvent,
        CancellationToken cancellationToken)
    {
        using var config = JsonDocument.Parse(channel.ConfigJson);
        var url = config.RootElement.GetProperty("url").GetString()
            ?? throw new InvalidOperationException("Webhook URL is missing");
        var payload = SerializePayload(alertEvent);
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        if (channel.SecretEnc is not null)
        {
            var secret = _cipher.Decrypt(channel.SecretEnc);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", secret);
            var signature = HMACSHA256.HashData(
                Encoding.UTF8.GetBytes(secret),
                Encoding.UTF8.GetBytes(payload));
            request.Headers.Add("X-NodeScope-Signature", $"sha256={Convert.ToHexStringLower(signature)}");
        }

        using var response = await _httpClients.CreateClient("NodeScopeAlerts")
            .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    private async Task SendEmailAsync(
        AlertChannelRecord channel,
        AlertEventRecord alertEvent,
        CancellationToken cancellationToken)
    {
        using var config = JsonDocument.Parse(channel.ConfigJson);
        var root = config.RootElement;
        var host = root.GetProperty("host").GetString()
            ?? throw new InvalidOperationException("SMTP host is missing");
        var port = root.TryGetProperty("port", out var portValue) && portValue.TryGetInt32(out var configuredPort)
            ? configuredPort
            : 587;
        var username = root.TryGetProperty("username", out var usernameValue)
            ? usernameValue.GetString()
            : null;

        using var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(
            root.GetProperty("fromAddr").GetString()
            ?? throw new InvalidOperationException("SMTP from address is missing")));
        foreach (var address in root.GetProperty("toAddrs").EnumerateArray())
        {
            message.To.Add(MailboxAddress.Parse(
                address.GetString()
                ?? throw new InvalidOperationException("SMTP recipient is missing")));
        }

        message.Subject = $"[{AlertLabels.Of(alertEvent.Severity)}] {alertEvent.RuleName} {AlertLabels.Of(alertEvent.Kind)}";
        message.Body = new TextPart("plain")
        {
            Text = string.Join(
                Environment.NewLine,
                $"Rule: {alertEvent.RuleName}",
                $"State: {AlertLabels.Of(alertEvent.Kind)}",
                $"Severity: {AlertLabels.Of(alertEvent.Severity)}",
                $"Device: {alertEvent.DeviceId ?? "none"}",
                $"Time: {alertEvent.CreatedAt.ToString("O", CultureInfo.InvariantCulture)}",
                "",
                alertEvent.DetailJson),
        };

        using var client = new SmtpClient { Timeout = 10_000 };
        await client.ConnectAsync(host, port, SecureSocketOptions.Auto, cancellationToken);
        if (!string.IsNullOrWhiteSpace(username))
        {
            await client.AuthenticateAsync(
                username,
                channel.SecretEnc is null ? "" : _cipher.Decrypt(channel.SecretEnc),
                cancellationToken);
        }

        await client.SendAsync(message, cancellationToken);
        await client.DisconnectAsync(quit: true, cancellationToken);
    }

    private Task SendInAppAsync(
        AlertEventRecord alertEvent,
        CancellationToken cancellationToken)
    {
        using var detail = JsonDocument.Parse(alertEvent.DetailJson);
        return _realtime.PushToAdminsAsync(
            alertEvent.OrganizationId,
            alertEvent.Kind == AlertEventKind.Firing ? WsEvents.AlertFired : WsEvents.AlertResolved,
            new
            {
                id = alertEvent.Id,
                ruleId = alertEvent.RuleId,
                ruleName = alertEvent.RuleName,
                deviceId = alertEvent.DeviceId,
                severity = AlertLabels.Of(alertEvent.Severity),
                detail = detail.RootElement.Clone(),
                at = alertEvent.CreatedAt,
            },
            cancellationToken);
    }

    private static string SerializePayload(AlertEventRecord alertEvent)
    {
        using var detail = JsonDocument.Parse(alertEvent.DetailJson);
        return JsonSerializer.Serialize(
            new
            {
                eventId = alertEvent.Id,
                ruleId = alertEvent.RuleId,
                rule = alertEvent.RuleName,
                deviceId = alertEvent.DeviceId,
                kind = AlertLabels.Of(alertEvent.Kind),
                severity = AlertLabels.Of(alertEvent.Severity),
                detail = detail.RootElement.Clone(),
                at = alertEvent.CreatedAt,
            },
            JsonOptions);
    }
}
