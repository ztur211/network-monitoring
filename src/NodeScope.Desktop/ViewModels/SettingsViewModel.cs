using System.Collections.ObjectModel;
using System.Globalization;
using Avalonia;
using Avalonia.Styling;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Map;

namespace NodeScope.Desktop.ViewModels;

/// <summary>One theme choice; null variant follows the OS.</summary>
internal sealed record ThemeOption(string? Key, string Label)
{
    /// <summary>Maps the persisted key onto Avalonia's variant.</summary>
    public ThemeVariant Variant => Key switch
    {
        "light" => ThemeVariant.Light,
        "dark" => ThemeVariant.Dark,
        _ => ThemeVariant.Default,
    };
}

/// <summary>One agent row with its two-step revoke state.</summary>
[INotifyPropertyChanged]
internal sealed partial class AgentRow(Agent agent)
{
    [ObservableProperty]
    private bool _confirmingRevoke;

    public Agent Agent { get; } = agent;

    public bool CanRevoke => Agent.Status != "REVOKED";

    /// <summary>Web parity colors: PENDING amber, APPROVED green, REVOKED red.</summary>
    public string StatusColor => Agent.Status switch
    {
        "APPROVED" => "#16a34a",
        "REVOKED" => "#dc2626",
        _ => "#d97706",
    };

    public string DetailLine
    {
        get
        {
            var parts = new List<string>(3);
            if (Agent.Platform is { Length: > 0 } platform)
            {
                parts.Add(platform);
            }

            if (Agent.Version is { Length: > 0 } version)
            {
                parts.Add($"v{version}");
            }

            if (Agent.LastSeenAt is { } seen)
            {
                parts.Add(string.Create(CultureInfo.InvariantCulture, $"last seen {seen:yyyy-MM-dd HH:mm} UTC"));
            }

            return parts.Count > 0 ? string.Join("  ·  ", parts) : "never seen";
        }
    }
}

/// <summary>One credential row with its two-step delete state.</summary>
[INotifyPropertyChanged]
internal sealed partial class SnmpCredentialRow(SnmpCredential credential)
{
    [ObservableProperty]
    private bool _confirmingDelete;

    public SnmpCredential Credential { get; } = credential;

    public string DetailLine
    {
        get
        {
            var parts = new List<string> { Credential.SnmpVersion };
            if (Credential.HasCommunity)
            {
                parts.Add("community set");
            }

            if (Credential.HasAuthKey)
            {
                parts.Add($"auth {Credential.AuthProtocol}");
            }

            if (Credential.HasPrivKey)
            {
                parts.Add($"priv {Credential.PrivProtocol}");
            }

            return string.Join("  ·  ", parts);
        }
    }
}

/// <summary>One editable OID row of the profile create form.</summary>
[INotifyPropertyChanged]
internal sealed partial class OidEntryDraft
{
    [ObservableProperty]
    private string _oid = "";

    [ObservableProperty]
    private string _metric = "";
}

/// <summary>One choice in the SNMP assignment pickers; a null id means "None" (clear).</summary>
internal sealed record AssignOption(string? Id, string Label);

/// <summary>
/// The settings section: profile, home location (server-side geocode), appearance
/// (local theme - the server preferences blob has no theme field), agents pairing,
/// the SNMP surface, and data sources. Agents and SNMP are OWNER/ADMIN server-side,
/// so they hide for a MEMBER instead of failing on load.
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class SettingsViewModel : IDisposable
{
    public static readonly IReadOnlyList<string> AllInvitationRoles =
        ["MEMBER", "ADMIN", "OWNER"];

    public static readonly IReadOnlyList<string> MemberInvitationRole = ["MEMBER"];

    public static readonly IReadOnlyList<string> SecurityLevels =
        ["NO_AUTH_NO_PRIV", "AUTH_NO_PRIV", "AUTH_PRIV"];

    public static readonly IReadOnlyList<string> AuthProtocols = ["MD5", "SHA", "SHA256"];

    public static readonly IReadOnlyList<string> PrivProtocols = ["DES", "AES", "AES256"];

    private readonly ApplianceSession _session;
    private readonly SettingsStore _settings;
    private readonly ILogger _logger;
    private readonly CancellationTokenSource _lifetime = new();

    private CurrentUser _user;

    // --- profile ----------------------------------------------------------

    [ObservableProperty]
    private string _profileName;

    [ObservableProperty]
    private string _profileEmail;

    [ObservableProperty]
    private string? _profileStatus;

    [ObservableProperty]
    private string? _profileError;

    [ObservableProperty]
    private bool _savingProfile;

    // --- home location ----------------------------------------------------

    [ObservableProperty]
    private string _addressText = "";

    [ObservableProperty]
    private string? _locationResult;

    [ObservableProperty]
    private string? _locationError;

    [ObservableProperty]
    private bool _settingLocation;

    // --- appearance -------------------------------------------------------

    [ObservableProperty]
    private ThemeOption _selectedTheme;

    // --- organization + access -------------------------------------------

    [ObservableProperty]
    private OrganizationSummary? _organization;

    [ObservableProperty]
    private string _accessRole = "MEMBER";

    [ObservableProperty]
    private IReadOnlyList<OrganizationMember> _organizationMembers = [];

    [ObservableProperty]
    private IReadOnlyList<PendingInvitation> _invitations = [];

    [ObservableProperty]
    private IReadOnlyList<OrganizationJoinRequest> _joinRequests = [];

    [ObservableProperty]
    private string _inviteEmail = "";

    [ObservableProperty]
    private string _inviteRole = "MEMBER";

    [ObservableProperty]
    private string? _invitationCode;

    [ObservableProperty]
    private string? _organizationError;

    [ObservableProperty]
    private bool _organizationBusy;

    // --- access + agents --------------------------------------------------

    [ObservableProperty]
    private bool _canManage;

    [ObservableProperty]
    private IReadOnlyList<AgentRow> _agents = [];

    [ObservableProperty]
    private string? _enrollmentCode;

    [ObservableProperty]
    private string? _agentsError;

    // --- snmp -------------------------------------------------------------

    [ObservableProperty]
    private IReadOnlyList<SnmpCredentialRow> _credentials = [];

    [ObservableProperty]
    private IReadOnlyList<OidProfileSummary> _profiles = [];

    [ObservableProperty]
    private string? _snmpError;

    [ObservableProperty]
    private bool _credentialFormOpen;

    [ObservableProperty]
    private string _credentialName = "";

    [ObservableProperty]
    private bool _credentialIsV3;

    [ObservableProperty]
    private string _credentialCommunity = "";

    [ObservableProperty]
    private string _credentialSecurityLevel = "AUTH_PRIV";

    [ObservableProperty]
    private string _credentialSecurityName = "";

    [ObservableProperty]
    private string _credentialAuthProtocol = "SHA";

    [ObservableProperty]
    private string _credentialAuthKey = "";

    [ObservableProperty]
    private string _credentialPrivProtocol = "AES";

    [ObservableProperty]
    private string _credentialPrivKey = "";

    [ObservableProperty]
    private bool _profileFormOpen;

    [ObservableProperty]
    private string _oidProfileName = "";

    [ObservableProperty]
    private bool _oidProfileInterfaceMetrics = true;

    // --- snmp assignment --------------------------------------------------

    [ObservableProperty]
    private bool _assignToDevice = true;

    [ObservableProperty]
    private IReadOnlyList<AssignOption> _assignTargets = [];

    [ObservableProperty]
    private AssignOption? _assignTarget;

    [ObservableProperty]
    private IReadOnlyList<AssignOption> _assignCredentials = [];

    [ObservableProperty]
    private AssignOption _assignCredential;

    [ObservableProperty]
    private IReadOnlyList<AssignOption> _assignProfiles = [];

    [ObservableProperty]
    private AssignOption _assignProfile;

    [ObservableProperty]
    private string? _assignResult;

    // --- data sources -----------------------------------------------------

    [ObservableProperty]
    private IReadOnlyList<DataSource> _dataSources = [];

    private IReadOnlyList<AssignOption> _deviceTargets = [];
    private IReadOnlyList<AssignOption> _networkTargets = [];

    public SettingsViewModel(
        ApplianceSession session,
        CurrentUser user,
        SettingsStore settings,
        ILogger logger)
    {
        _session = session;
        _user = user;
        _settings = settings;
        _logger = logger;

        _profileName = user.Name ?? "";
        _profileEmail = user.Email;
        var storedTheme = settings.Load().Theme;
        _selectedTheme = Themes.FirstOrDefault(option => option.Key == storedTheme) ?? Themes[0];
        _assignCredential = new AssignOption(null, "None");
        _assignProfile = new AssignOption(null, "None");

        Initialization = LoadAsync();
    }

    /// <summary>The initial load; awaited by tests.</summary>
    internal Task Initialization { get; }

    public IReadOnlyList<ThemeOption> Themes { get; } =
    [
        new(null, "Follow system"),
        new("light", "Light"),
        new("dark", "Dark"),
    ];

    public IReadOnlyList<string> InvitationRoles =>
        AccessRole == "OWNER" ? AllInvitationRoles : MemberInvitationRole;

    public bool CanMutateOrganization => !OrganizationBusy;

    /// <summary>The copy-paste agent install command, built from this appliance's URL.</summary>
    public string? InstallCommand => EnrollmentCode is null
        ? null
        : $"curl -fsSL {_session.Client.BaseUrl}agent/install.sh | sudo bash -s -- "
          + $"--server {_session.Client.BaseUrl} --code {EnrollmentCode}";

    public string? EnrollCommand => EnrollmentCode is null
        ? null
        : $"nodescope-agent enroll --code {EnrollmentCode}";

    public ObservableCollection<OidEntryDraft> OidEntries { get; } = [];

    public void Dispose()
    {
        _lifetime.Cancel();
        _lifetime.Dispose();
    }

    [RelayCommand]
    public async Task LoadAsync()
    {
        try
        {
            var access = await _session.Client.GetAccessSummaryAsync(_session.Token, _lifetime.Token);
            CanManage = access.CanConfigure;
            AccessRole = access.Role;

            var organizationTask = _session.Client.GetOrganizationAsync(
                _session.Token, _lifetime.Token);
            var membersTask = _session.Client.GetOrganizationMembersAsync(
                _session.Token, _lifetime.Token);
            var dataSourcesTask = _session.Client.GetDataSourcesAsync(
                _session.Token, _lifetime.Token);
            await Task.WhenAll(organizationTask, membersTask, dataSourcesTask);
            Organization = await organizationTask;
            OrganizationMembers = await membersTask;
            DataSources = await dataSourcesTask;
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            SettingsLog.LoadFailed(_logger, "access", failure);
            OrganizationError = failure.Message;
        }

        if (!CanManage)
        {
            return; // agents + snmp are OWNER/ADMIN-only server-side
        }

        await LoadOrganizationManagementAsync();
        await LoadAgentsAsync();
        await LoadSnmpAsync();
    }

    // --- organization -----------------------------------------------------

    [RelayCommand]
    private async Task CreateInvitationAsync()
    {
        var email = InviteEmail.Trim();
        OrganizationError = null;
        InvitationCode = null;
        if (email.Length == 0 || !email.Contains('@', StringComparison.Ordinal))
        {
            OrganizationError = "Enter the teammate's email address.";
            return;
        }

        var role = InvitationRoles.Contains(InviteRole, StringComparer.Ordinal)
            ? InviteRole
            : "MEMBER";
        OrganizationBusy = true;
        try
        {
            var created = await _session.Client.CreateInvitationAsync(
                _session.Token, email, role, _lifetime.Token);
            Invitations =
            [
                created.Invitation,
                .. Invitations.Where(invitation =>
                    !string.Equals(invitation.Email, created.Invitation.Email, StringComparison.OrdinalIgnoreCase)),
            ];
            InvitationCode = $"nodescope-invite-v1:{created.Token}";
            InviteEmail = "";
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            OrganizationError = failure.Message;
            SettingsLog.MutationFailed(_logger, "invitation-create", failure);
        }
        finally
        {
            OrganizationBusy = false;
        }
    }

    [RelayCommand]
    private async Task RevokeInvitationAsync(PendingInvitation invitation)
    {
        OrganizationError = null;
        OrganizationBusy = true;
        try
        {
            await _session.Client.RevokeInvitationAsync(
                _session.Token, invitation.Id, _lifetime.Token);
            Invitations = [.. Invitations.Where(candidate => candidate.Id != invitation.Id)];
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            OrganizationError = failure.Message;
            SettingsLog.MutationFailed(_logger, "invitation-revoke", failure);
        }
        finally
        {
            OrganizationBusy = false;
        }
    }

    [RelayCommand]
    private Task ApproveJoinRequestAsync(OrganizationJoinRequest request) =>
        DecideJoinRequestAsync(request, approve: true);

    [RelayCommand]
    private Task DenyJoinRequestAsync(OrganizationJoinRequest request) =>
        DecideJoinRequestAsync(request, approve: false);

    private async Task DecideJoinRequestAsync(OrganizationJoinRequest request, bool approve)
    {
        OrganizationError = null;
        OrganizationBusy = true;
        try
        {
            await _session.Client.DecideJoinRequestAsync(
                _session.Token, request.Id, approve, _lifetime.Token);
            JoinRequests = [.. JoinRequests.Where(candidate => candidate.Id != request.Id)];
            if (approve)
            {
                OrganizationMembers = await _session.Client.GetOrganizationMembersAsync(
                    _session.Token, _lifetime.Token);
            }
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            OrganizationError = failure.Message;
            SettingsLog.MutationFailed(_logger, "join-request-decision", failure);
        }
        finally
        {
            OrganizationBusy = false;
        }
    }

    partial void OnAccessRoleChanged(string value)
    {
        OnPropertyChanged(nameof(InvitationRoles));
        if (!InvitationRoles.Contains(InviteRole, StringComparer.Ordinal))
        {
            InviteRole = "MEMBER";
        }
    }

    partial void OnOrganizationBusyChanged(bool value) =>
        OnPropertyChanged(nameof(CanMutateOrganization));

    // --- profile ----------------------------------------------------------

    [RelayCommand]
    private async Task SaveProfileAsync()
    {
        var name = ProfileName.Trim();
        // The server lowercases emails on both store and lookup; no need to pre-fold here.
        var email = ProfileEmail.Trim();
        var newName = name != (_user.Name ?? "") ? name : null;
        var newEmail = email != _user.Email ? email : null;
        ProfileStatus = null;
        ProfileError = null;
        if (newName is null && newEmail is null)
        {
            ProfileStatus = "Nothing to save.";
            return;
        }

        SavingProfile = true;
        try
        {
            _user = await _session.Client.UpdateMeAsync(
                _session.Token, newName, newEmail, _lifetime.Token);
            ProfileName = _user.Name ?? "";
            ProfileEmail = _user.Email;
            ProfileStatus = "Saved.";
        }
        catch (ApplianceApiException failure) when (failure.Code == "AUTH_005")
        {
            ProfileError = "That email is already in use.";
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            ProfileError = failure.Message;
            SettingsLog.MutationFailed(_logger, "profile", failure);
        }
        finally
        {
            SavingProfile = false;
        }
    }

    // --- home location ----------------------------------------------------

    [RelayCommand]
    private async Task SetLocationAsync()
    {
        var address = AddressText.Trim();
        if (address.Length == 0)
        {
            return;
        }

        SettingLocation = true;
        LocationResult = null;
        LocationError = null;
        try
        {
            var location = await _session.Client.SetHomeLocationAsync(_session.Token, address, _lifetime.Token);
            LocationResult = string.Create(
                CultureInfo.InvariantCulture,
                $"Home set to {location.Latitude:F5}, {location.Longitude:F5}");
            if (location.Address is { Length: > 0 } resolved)
            {
                LocationResult += $" ({resolved})";
            }
        }
        catch (ApplianceApiException failure) when (failure.Code == "MAP_001")
        {
            LocationError = "Geocoding failed. Try a more specific address.";
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            LocationError = failure.Message;
            SettingsLog.MutationFailed(_logger, "location", failure);
        }
        finally
        {
            SettingLocation = false;
        }
    }

    // --- appearance -------------------------------------------------------

    partial void OnSelectedThemeChanged(ThemeOption value)
    {
        ApplyTheme(value);
        _settings.Save(_settings.Load() with { Theme = value.Key });
    }

    /// <summary>Null-tolerant so plain unit tests (no Avalonia app) can exercise the VM.</summary>
    internal static void ApplyTheme(ThemeOption option)
    {
        if (Application.Current is { } application)
        {
            application.RequestedThemeVariant = option.Variant;
        }
    }

    // --- agents -----------------------------------------------------------

    [RelayCommand]
    private async Task GenerateEnrollmentCodeAsync()
    {
        AgentsError = null;
        try
        {
            EnrollmentCode = await _session.Client.CreateAgentEnrollmentCodeAsync(_session.Token, _lifetime.Token);
            OnPropertyChanged(nameof(InstallCommand));
            OnPropertyChanged(nameof(EnrollCommand));
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            AgentsError = failure.Message;
            SettingsLog.MutationFailed(_logger, "enrollment-code", failure);
        }
    }

    [RelayCommand]
    private async Task RevokeAgentAsync(AgentRow row)
    {
        if (!row.ConfirmingRevoke)
        {
            foreach (var candidate in Agents)
            {
                candidate.ConfirmingRevoke = false;
            }

            row.ConfirmingRevoke = true;
            return;
        }

        AgentsError = null;
        try
        {
            await _session.Client.RevokeAgentAsync(_session.Token, row.Agent.Id, _lifetime.Token);
            await LoadAgentsAsync();
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            row.ConfirmingRevoke = false;
            AgentsError = failure.Message;
            SettingsLog.MutationFailed(_logger, "agent-revoke", failure);
        }
    }

    // --- snmp -------------------------------------------------------------

    [RelayCommand]
    private void ToggleCredentialForm() => CredentialFormOpen = !CredentialFormOpen;

    [RelayCommand]
    private async Task CreateCredentialAsync()
    {
        var name = CredentialName.Trim();
        if (name.Length == 0)
        {
            SnmpError = "The credential needs a name.";
            return;
        }

        var create = CredentialIsV3
            ? new CreateSnmpCredential(
                name,
                "V3",
                CredentialSecurityLevel,
                NullIfEmpty(CredentialSecurityName),
                CredentialSecurityLevel == "NO_AUTH_NO_PRIV" ? null : CredentialAuthProtocol,
                CredentialSecurityLevel == "AUTH_PRIV" ? CredentialPrivProtocol : null,
                null,
                CredentialSecurityLevel == "NO_AUTH_NO_PRIV" ? null : NullIfEmpty(CredentialAuthKey),
                CredentialSecurityLevel == "AUTH_PRIV" ? NullIfEmpty(CredentialPrivKey) : null)
            : new CreateSnmpCredential(
                name, "V2C", null, null, null, null, NullIfEmpty(CredentialCommunity), null, null);

        SnmpError = null;
        try
        {
            var created = await _session.Client.CreateSnmpCredentialAsync(_session.Token, create, _lifetime.Token);
            Credentials = [new SnmpCredentialRow(created), .. Credentials];
            RebuildAssignOptions();
            CredentialFormOpen = false;
            CredentialName = "";
            CredentialCommunity = "";
            CredentialSecurityName = "";
            CredentialAuthKey = "";
            CredentialPrivKey = "";
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            SnmpError = failure.Message;
            SettingsLog.MutationFailed(_logger, "snmp-credential-create", failure);
        }
    }

    [RelayCommand]
    private async Task DeleteCredentialAsync(SnmpCredentialRow row)
    {
        if (!row.ConfirmingDelete)
        {
            foreach (var candidate in Credentials)
            {
                candidate.ConfirmingDelete = false;
            }

            row.ConfirmingDelete = true;
            return;
        }

        SnmpError = null;
        try
        {
            await _session.Client.DeleteSnmpCredentialAsync(_session.Token, row.Credential.Id, _lifetime.Token);
            Credentials = [.. Credentials.Where(candidate => candidate != row)];
            RebuildAssignOptions();
        }
        catch (ApplianceApiException failure) when (failure.Code == "SNMP_003")
        {
            row.ConfirmingDelete = false;
            SnmpError = "This credential is still assigned to a device or network - unassign it first.";
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            row.ConfirmingDelete = false;
            SnmpError = failure.Message;
            SettingsLog.MutationFailed(_logger, "snmp-credential-delete", failure);
        }
    }

    [RelayCommand]
    private void ToggleProfileForm() => ProfileFormOpen = !ProfileFormOpen;

    [RelayCommand]
    private void AddOidEntry() => OidEntries.Add(new OidEntryDraft());

    [RelayCommand]
    private void RemoveOidEntry(OidEntryDraft entry) => OidEntries.Remove(entry);

    [RelayCommand]
    private async Task CreateOidProfileAsync()
    {
        var name = OidProfileName.Trim();
        if (name.Length == 0)
        {
            SnmpError = "The profile needs a name.";
            return;
        }

        var entries = OidEntries
            .Where(entry => entry.Oid.Trim().Length > 0 && entry.Metric.Trim().Length > 0)
            .Select(entry => new CreateOidEntry(entry.Oid.Trim(), entry.Metric.Trim()))
            .ToList();

        SnmpError = null;
        try
        {
            var created = await _session.Client.CreateOidProfileAsync(
                _session.Token,
                new CreateOidProfile(name, OidProfileInterfaceMetrics, entries),
                _lifetime.Token);
            Profiles = [created, .. Profiles];
            RebuildAssignOptions();
            ProfileFormOpen = false;
            OidProfileName = "";
            OidEntries.Clear();
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            SnmpError = failure.Message;
            SettingsLog.MutationFailed(_logger, "oid-profile-create", failure);
        }
    }

    [RelayCommand]
    private async Task AssignAsync()
    {
        if (AssignTarget is not { Id: { } targetId })
        {
            AssignResult = "Pick a target first.";
            return;
        }

        AssignResult = null;
        try
        {
            var result = await _session.Client.AssignSnmpAsync(
                _session.Token,
                new SnmpAssignment(
                    AssignToDevice ? "device" : "network",
                    targetId,
                    AssignCredential.Id,
                    AssignProfile.Id),
                _lifetime.Token);
            AssignResult = result is { SnmpCredentialId: null, OidProfileId: null }
                ? "Assignment cleared."
                : "Assigned.";
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            AssignResult = failure.Message;
            SettingsLog.MutationFailed(_logger, "snmp-assign", failure);
        }
    }

    [RelayCommand]
    private void SelectAssignDevice() => AssignToDevice = true;

    [RelayCommand]
    private void SelectAssignNetwork() => AssignToDevice = false;

    partial void OnAssignToDeviceChanged(bool value)
    {
        AssignTargets = value ? _deviceTargets : _networkTargets;
        AssignTarget = AssignTargets.Count > 0 ? AssignTargets[0] : null;
    }

    private async Task LoadOrganizationManagementAsync()
    {
        try
        {
            var invitationsTask = _session.Client.GetInvitationsAsync(
                _session.Token, _lifetime.Token);
            var joinRequestsTask = _session.Client.GetJoinRequestsAsync(
                _session.Token, _lifetime.Token);
            await Task.WhenAll(invitationsTask, joinRequestsTask);
            Invitations = await invitationsTask;
            JoinRequests = await joinRequestsTask;
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            OrganizationError = failure.Message;
            SettingsLog.LoadFailed(_logger, "organization-management", failure);
        }
    }

    private async Task LoadAgentsAsync()
    {
        try
        {
            var agents = await _session.Client.GetAgentsAsync(_session.Token, _lifetime.Token);
            Agents = [.. agents.Select(agent => new AgentRow(agent))];
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            AgentsError = failure.Message;
            SettingsLog.LoadFailed(_logger, "agents", failure);
        }
    }

    private async Task LoadSnmpAsync()
    {
        try
        {
            var credentialsTask = _session.Client.GetSnmpCredentialsAsync(_session.Token, _lifetime.Token);
            var profilesTask = _session.Client.GetOidProfilesAsync(_session.Token, _lifetime.Token);
            var devicesTask = _session.Client.GetDeviceInventoryAsync(_session.Token, _lifetime.Token);
            var networksTask = _session.Client.GetNetworksAsync(_session.Token, _lifetime.Token);
            await Task.WhenAll(credentialsTask, profilesTask, devicesTask, networksTask);

            Credentials = [.. (await credentialsTask).Select(credential => new SnmpCredentialRow(credential))];
            Profiles = await profilesTask;
            _deviceTargets =
            [
                .. (await devicesTask).Items.Select(device => new AssignOption(
                    device.Id, $"{device.Name} ({DeviceCategories.Resolve(device.Category).DisplayName})")),
            ];
            _networkTargets = [.. (await networksTask).Select(network => new AssignOption(network.Id, network.Name))];
            AssignTargets = AssignToDevice ? _deviceTargets : _networkTargets;
            AssignTarget = AssignTargets.Count > 0 ? AssignTargets[0] : null;
            RebuildAssignOptions();
        }
        catch (Exception failure) when (failure is ApplianceApiException or HttpRequestException)
        {
            SnmpError = failure.Message;
            SettingsLog.LoadFailed(_logger, "snmp", failure);
        }
    }

    private void RebuildAssignOptions()
    {
        AssignCredentials =
        [
            new AssignOption(null, "None"),
            .. Credentials.Select(row => new AssignOption(row.Credential.Id, row.Credential.Name)),
        ];
        AssignProfiles =
        [
            new AssignOption(null, "None"),
            .. Profiles.Select(profile => new AssignOption(profile.Id, profile.Name)),
        ];
        AssignCredential = AssignCredentials.FirstOrDefault(option => option.Id == AssignCredential.Id)
            ?? AssignCredentials[0];
        AssignProfile = AssignProfiles.FirstOrDefault(option => option.Id == AssignProfile.Id)
            ?? AssignProfiles[0];
    }

    private static string? NullIfEmpty(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length > 0 ? trimmed : null;
    }
}

internal static partial class SettingsLog
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Settings {Surface} load failed")]
    public static partial void LoadFailed(ILogger logger, string surface, Exception exception);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Settings {Operation} failed")]
    public static partial void MutationFailed(ILogger logger, string operation, Exception exception);
}
