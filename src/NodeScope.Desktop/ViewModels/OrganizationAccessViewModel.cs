using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;

namespace NodeScope.Desktop.ViewModels;

/// <summary>
/// The authenticated, pre-workspace surface. A new account can redeem an invitation
/// credential or ask the organization claiming its email domain for access.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class OrganizationAccessViewModel : IDisposable
{
    private readonly DesktopAuthFlow _flow;
    private readonly ApplianceSession _session;
    private readonly CancellationTokenSource _lifetime = new();

    [ObservableProperty]
    private string _invitationInput = "";

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _error;

    [ObservableProperty]
    private string? _status;

    [ObservableProperty]
    private string _organizationName = "";

    [ObservableProperty]
    private string _bootstrapToken = "";

    public OrganizationAccessViewModel(
        DesktopAuthFlow flow,
        ApplianceSession session,
        CurrentUser user,
        Uri serverUrl)
    {
        _flow = flow;
        _session = session;
        User = user;
        ServerUrl = serverUrl;
    }

    public CurrentUser User { get; }

    public Uri ServerUrl { get; }

    public string UserLabel => User.Name is { Length: > 0 } name ? name : User.Email;

    public void Dispose()
    {
        _lifetime.Cancel();
        _lifetime.Dispose();
    }

    [RelayCommand]
    private async Task AcceptInvitationAsync()
    {
        var token = ParseInvitationToken(InvitationInput);
        Error = null;
        Status = null;
        if (token is null)
        {
            Error = "Paste the invitation code you received.";
            return;
        }

        Busy = true;
        try
        {
            await _session.Client.AcceptInvitationAsync(
                _session.Token, token, _lifetime.Token);
            await _flow.RefreshOrganizationAsync(_lifetime.Token);
        }
        catch (ApplianceApiException failure)
        {
            Error = failure.Code switch
            {
                "ORG_009" => "That invitation is invalid, expired, or already used.",
                "ORG_010" => "This invitation was issued to a different email address.",
                "ORG_011" => "This account already belongs to an organization.",
                _ => failure.Message,
            };
        }
        catch (HttpRequestException failure)
        {
            Error = $"Could not reach the appliance: {failure.Message}";
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand]
    private async Task RequestAccessAsync()
    {
        Error = null;
        Status = null;
        Busy = true;
        try
        {
            await _session.Client.SubmitJoinRequestAsync(_session.Token, _lifetime.Token);
            Status = "Request sent. An organization owner or administrator can approve it.";
        }
        catch (ApplianceApiException failure)
        {
            Error = failure.Code switch
            {
                "ORG_014" => "No organization has claimed this email domain. Ask an administrator for an invitation code.",
                "ORG_015" => "A request for this account is already waiting for approval.",
                "ORG_011" => "This account already belongs to an organization.",
                _ => failure.Message,
            };
        }
        catch (HttpRequestException failure)
        {
            Error = $"Could not reach the appliance: {failure.Message}";
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand]
    private async Task BootstrapOrganizationAsync()
    {
        var name = OrganizationName.Trim();
        var token = BootstrapToken.Trim();
        Error = null;
        Status = null;
        if (name.Length == 0 || token.Length == 0)
        {
            Error = "Enter an organization name and the bootstrap code printed by the installer.";
            return;
        }

        Busy = true;
        try
        {
            _ = await _session.Client.BootstrapOrganizationAsync(
                _session.Token, name, token, _lifetime.Token);
            BootstrapToken = "";
            await _flow.RefreshOrganizationAsync(_lifetime.Token);
        }
        catch (ApplianceApiException failure)
        {
            Error = failure.Code switch
            {
                "ORG_016" => "This appliance was not configured with a bootstrap code.",
                "ORG_017" => "The bootstrap code is not valid.",
                "ORG_018" => "This appliance already has an organization. Ask its administrator for an invitation.",
                _ => failure.Message,
            };
        }
        catch (HttpRequestException failure)
        {
            Error = $"Could not reach the appliance: {failure.Message}";
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand]
    private Task SignOutAsync() => _flow.SignOutAsync(CancellationToken.None);

    /// <summary>
    /// Accepts the native code and legacy <c>https://host/invite/{token}</c> form so
    /// invitations copied before the browser surface was removed remain redeemable.
    /// </summary>
    internal static string? ParseInvitationToken(string input)
    {
        var candidate = input.Trim();
        if (candidate.Length == 0)
        {
            return null;
        }

        const string prefix = "nodescope-invite-v1:";
        if (candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return candidate[prefix.Length..].Trim() is { Length: > 0 } prefixed
                ? prefixed
                : null;
        }

        if (Uri.TryCreate(candidate, UriKind.Absolute, out var uri))
        {
            var segments = uri.AbsolutePath.Split(
                '/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (segments is [.., "invite", { Length: > 0 } token])
            {
                return Uri.UnescapeDataString(token);
            }

            return null;
        }

        return candidate;
    }
}
