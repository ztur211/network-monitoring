using System.Text.Json;
using NodeScope.Modules.Alerting.Application;
using Xunit;

namespace NodeScope.Alerting.Tests;

public sealed class AlertRequestTests
{
    [Fact]
    public void Webhook_requires_an_absolute_http_url()
    {
        var request = new CreateAlertChannelRequest
        {
            Type = "WEBHOOK",
            Name = "Operations",
            Config = Json("""{"url":"ftp://example.test/hook"}"""),
        };

        Assert.Contains(
            "config.url must be an absolute HTTP or HTTPS URL without embedded credentials",
            request.Validate());
    }

    [Fact]
    public void Email_requires_valid_port_and_recipients()
    {
        var request = new CreateAlertChannelRequest
        {
            Type = "EMAIL",
            Name = "Operations",
            Config = Json(
                """{"host":"smtp.example.test","port":70000,"fromAddr":"bad","toAddrs":[]}"""),
        };

        var errors = request.Validate();

        Assert.Contains("config.port must be between 1 and 65535", errors);
        Assert.Contains("config.fromAddr must be an email address", errors);
        Assert.Contains("config.toAddrs must be a non-empty array of email addresses", errors);
    }

    [Fact]
    public void Channel_config_rejects_wrong_types_duplicate_or_plaintext_secret_fields()
    {
        var email = new CreateAlertChannelRequest
        {
            Type = "EMAIL",
            Name = "Operations",
            Config = Json(
                """
                {
                  "host": "smtp.example.test",
                  "port": "587",
                  "fromAddr": "ops@example.test",
                  "toAddrs": ["noc@example.test"],
                  "password": "plaintext"
                }
                """),
        };
        var inApp = new CreateAlertChannelRequest
        {
            Type = "INAPP",
            Name = "Desktop",
            Config = Json("""{"url":"https://example.test"}"""),
            Secret = "unused",
        };
        var webhook = new CreateAlertChannelRequest
        {
            Type = "WEBHOOK",
            Name = "Duplicate",
            Config = Json(
                """
                {
                  "url": "https://one.example.test",
                  "url": "https://two.example.test"
                }
                """),
        };

        var emailErrors = email.Validate();
        var inAppErrors = inApp.Validate();
        Assert.Contains("config.port must be between 1 and 65535", emailErrors);
        Assert.Contains(
            "config.password is not allowed for this channel type",
            emailErrors);
        Assert.Contains(
            "config.url is not allowed for this channel type",
            inAppErrors);
        Assert.Contains("secret is not allowed for an in-app channel", inAppErrors);
        Assert.Contains("config.url must not be duplicated", webhook.Validate());
    }

    [Fact]
    public void State_rule_requires_one_scope_target_states_and_channels()
    {
        var request = new CreateAlertRuleRequest
        {
            Name = "Device down",
            Trigger = "STATE_TRANSITION",
            Scope = new AlertScopeDto { All = true },
            Severity = "CRITICAL",
            ChannelIds = [],
            CooldownSeconds = 60,
            NotifyOnRecovery = true,
            TargetStates = [],
        };

        var errors = request.Validate();

        Assert.Contains("channelIds should not be empty", errors);
        Assert.Contains("targetStates must contain DOWN or WARNING", errors);
    }

    [Fact]
    public void Metric_rule_rejects_non_finite_or_invalid_window()
    {
        var request = new CreateAlertRuleRequest
        {
            Name = "Latency",
            Trigger = "METRIC_THRESHOLD",
            Scope = new AlertScopeDto { All = true },
            Severity = "WARNING",
            ChannelIds = [Guid.NewGuid().ToString()],
            CooldownSeconds = 60,
            NotifyOnRecovery = true,
            Metric = "latencyMs",
            Op = "gt",
            Threshold = double.PositiveInfinity,
            ForSeconds = 0,
        };

        var errors = request.Validate();

        Assert.Contains("threshold must be a finite number between 0 and 600000", errors);
        Assert.Contains("forSeconds must be between 1 and 86400", errors);
    }

    [Fact]
    public void Scope_is_fail_closed_when_more_than_one_selector_is_present()
    {
        var errors = new List<string>();

        var scope = new AlertScopeDto
        {
            All = true,
            DeviceIds = [Guid.NewGuid().ToString()],
        }.Validate(errors);

        Assert.Null(scope);
        Assert.Single(errors);
    }

    private static JsonElement Json(string value)
    {
        using var document = JsonDocument.Parse(value);
        return document.RootElement.Clone();
    }
}
