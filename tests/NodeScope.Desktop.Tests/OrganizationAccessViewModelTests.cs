using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Auth;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class OrganizationAccessViewModelTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly DirectoryInfo _scratch =
        Directory.CreateTempSubdirectory("nodescope-org-access-");
    private readonly FakeApplianceClientFactory _clients = new();
    private readonly InMemoryTokenVault _vault = new();
    private readonly DesktopAuthFlow _flow;
    private OrganizationAccessViewModel? _viewModel;

    public OrganizationAccessViewModelTests()
    {
        var settings = new SettingsStore(Path.Combine(_scratch.FullName, "settings.json"));
        _clients.Configure = client =>
            client.AccessFailure = new ApplianceApiException("ORG_002", "NOT_AN_ORG_MEMBER", 403);
        _flow = new DesktopAuthFlow(
            _clients, _vault, settings, NullLogger<DesktopAuthFlow>.Instance);
    }

    public void Dispose()
    {
        _viewModel?.Dispose();
        _flow.Dispose();
        _scratch.Delete(recursive: true);
    }

    [Theory]
    [InlineData("raw-token", "raw-token")]
    [InlineData(" nodescope-invite-v1:prefixed-token ", "prefixed-token")]
    [InlineData("https://appliance.local/invite/url-token", "url-token")]
    [InlineData("https://appliance.local/other/url-token", null)]
    [InlineData("", null)]
    public void Invitation_input_accepts_native_codes_and_legacy_links(
        string input,
        string? expected) =>
        Assert.Equal(expected, OrganizationAccessViewModel.ParseInvitationToken(input));

    [Fact]
    public async Task A_valid_invitation_joins_and_routes_into_the_workspace()
    {
        var viewModel = await CreateAsync();
        var client = _clients.Last;
        viewModel.InvitationInput = "https://appliance.local/invite/invite-token";

        // Redeeming the token changes the server-side membership verdict.
        client.AccessFailure = null;
        await viewModel.AcceptInvitationCommand.ExecuteAsync(null);

        Assert.Equal("invite-token", Assert.Single(client.AcceptedInvitationTokens));
        Assert.Equal(SessionPhase.SignedIn, _flow.Current.Phase);
        Assert.Null(viewModel.Error);
    }

    [Fact]
    public async Task Invitation_errors_have_actionable_native_copy()
    {
        var viewModel = await CreateAsync();
        _clients.Last.AccessFailure =
            new ApplianceApiException("ORG_009", "INVITATION_INVALID", 404);
        viewModel.InvitationInput = "spent-token";

        await viewModel.AcceptInvitationCommand.ExecuteAsync(null);

        Assert.Equal("That invitation is invalid, expired, or already used.", viewModel.Error);
        Assert.Equal(SessionPhase.NeedsOrganization, _flow.Current.Phase);
    }

    [Fact]
    public async Task Domain_join_request_confirms_submission_and_maps_an_unclaimed_domain()
    {
        var viewModel = await CreateAsync();
        var client = _clients.Last;
        client.AccessFailure = null;

        await viewModel.RequestAccessCommand.ExecuteAsync(null);
        Assert.Equal(1, client.JoinRequestSubmissions);
        Assert.Contains("Request sent", viewModel.Status, StringComparison.Ordinal);

        client.AccessFailure =
            new ApplianceApiException("ORG_014", "NO_MATCHING_ORG_FOR_DOMAIN", 404);
        await viewModel.RequestAccessCommand.ExecuteAsync(null);
        Assert.Contains("invitation code", viewModel.Error, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_installer_code_bootstraps_the_first_organization_and_enters_the_workspace()
    {
        var viewModel = await CreateAsync();
        viewModel.OrganizationName = "Northwind Networks";
        viewModel.BootstrapToken = "bootstrap-credential";

        await viewModel.BootstrapOrganizationCommand.ExecuteAsync(null);

        Assert.Equal(
            ("Northwind Networks", "bootstrap-credential"),
            Assert.Single(_clients.Last.BootstrapRequests));
        Assert.Equal(SessionPhase.SignedIn, _flow.Current.Phase);
        Assert.Equal("", viewModel.BootstrapToken);
    }

    [Fact]
    public async Task A_rejected_bootstrap_code_has_specific_copy()
    {
        var viewModel = await CreateAsync();
        _clients.Last.AccessFailure =
            new ApplianceApiException("ORG_017", "BOOTSTRAP_TOKEN_INVALID", 403);
        viewModel.OrganizationName = "Northwind Networks";
        viewModel.BootstrapToken = "wrong";

        await viewModel.BootstrapOrganizationCommand.ExecuteAsync(null);

        Assert.Equal("The bootstrap code is not valid.", viewModel.Error);
        Assert.Equal(SessionPhase.NeedsOrganization, _flow.Current.Phase);
    }

    private async Task<OrganizationAccessViewModel> CreateAsync()
    {
        await _flow.SignInAsync(
            Server, "teammate@acme.test", "devpassword123", CancellationToken.None);
        Assert.Equal(SessionPhase.NeedsOrganization, _flow.Current.Phase);
        _viewModel = new OrganizationAccessViewModel(
            _flow,
            _flow.Session!,
            _flow.Current.User!,
            Server);
        return _viewModel;
    }
}
