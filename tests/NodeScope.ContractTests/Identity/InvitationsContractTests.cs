namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the invitation surface beyond the happy path the provisioning
/// harness exercises: the pending list (accepted invitations drop out), the
/// error envelopes (unknown revoke ORG_009; accept with a bad token ORG_009, a
/// mismatched email ORG_010, or an already-membered user ORG_011), and the role
/// matrix on create - the controller admits OWNER/ADMIN only, and an ADMIN may
/// invite nothing above MEMBER (PERM_003).
/// </summary>
[Collection(ContractSuite.Name)]
public class InvitationsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public InvitationsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task List_returns_pending_invitations_and_accepted_ones_drop_out()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var email = AuthWorkflow.NewEmail("pending");

        var invite = await _api.PostAsync(
            "v1/organizations/me/invitations",
            new { email, role = "MEMBER" },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, invite.Status);
        var invitationId = invite.Data.GetProperty("invitation").GetProperty("id").GetString();

        var list = await _api.GetAsync("v1/organizations/me/invitations", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var row = list.Data.EnumerateArray().Single(i => i.GetProperty("id").GetString() == invitationId);
        Assert.Equal(email, row.GetProperty("email").GetString());
        Assert.Equal("MEMBER", row.GetProperty("role").GetString());
        Assert.Equal(JsonValueKind.Null, row.GetProperty("acceptedAt").ValueKind);
        Assert.False(string.IsNullOrEmpty(row.GetProperty("expiresAt").GetString()));

        // Accepting removes it from the pending list.
        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        var after = await _api.GetAsync("v1/organizations/me/invitations", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, after.Status);
        Assert.DoesNotContain(
            after.Data.EnumerateArray(),
            i => i.GetProperty("email").GetString() == member.Email);
    }

    [Fact]
    public async Task Revoking_an_unknown_invitation_is_404_ORG_009()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.DeleteAsync(
            $"v1/organizations/me/invitations/{Guid.NewGuid()}",
            org.OwnerCookie);

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("ORG_009", response.ErrorCode);
    }

    [Fact]
    public async Task Admin_may_invite_MEMBERs_only_PERM_003_and_a_MEMBER_not_at_all()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var admin = await OrgProvisioning.AddMemberAsync(_api, org, role: "ADMIN");
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        var adminInvitesAdmin = await _api.PostAsync(
            "v1/organizations/me/invitations",
            new { email = AuthWorkflow.NewEmail(), role = "ADMIN" },
            admin.AsCookie());
        Assert.Equal(HttpStatusCode.Forbidden, adminInvitesAdmin.Status);
        Assert.Equal("PERM_003", adminInvitesAdmin.ErrorCode);

        var adminInvitesMember = await _api.PostAsync(
            "v1/organizations/me/invitations",
            new { email = AuthWorkflow.NewEmail(), role = "MEMBER" },
            admin.AsCookie());
        Assert.Equal(HttpStatusCode.Created, adminInvitesMember.Status);

        var memberInvites = await _api.PostAsync(
            "v1/organizations/me/invitations",
            new { email = AuthWorkflow.NewEmail(), role = "MEMBER" },
            member.AsCookie());
        Assert.Equal(HttpStatusCode.Forbidden, memberInvites.Status);
        Assert.Equal("ORG_003", memberInvites.ErrorCode);
    }

    [Fact]
    public async Task Accepting_a_bad_token_is_404_ORG_009()
    {
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync(
            "v1/invitations/accept",
            new { token = "not-a-real-token" },
            user.AsCookie());

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("ORG_009", response.ErrorCode);
    }

    [Fact]
    public async Task Accepting_with_a_mismatched_email_is_403_ORG_010()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var invite = await _api.PostAsync(
            "v1/organizations/me/invitations",
            new { email = AuthWorkflow.NewEmail("invited"), role = "MEMBER" },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, invite.Status);
        var token = invite.Data.GetProperty("token").GetString();

        // A different user holds a valid token for someone else's email.
        var impostor = await AuthWorkflow.SignUpAsync(_api);
        var response = await _api.PostAsync(
            "v1/invitations/accept",
            new { token },
            impostor.AsCookie());

        Assert.Equal(HttpStatusCode.Forbidden, response.Status);
        Assert.Equal("ORG_010", response.ErrorCode);
    }

    [Fact]
    public async Task Accepting_while_already_in_an_org_is_409_ORG_011()
    {
        var orgA = await _fixture.ProvisionOrgAsync();
        var orgB = await _fixture.ProvisionOrgAsync();

        // Org B invites org A's OWNER at their real email - the token and email
        // match, but the user already belongs somewhere.
        var invite = await _api.PostAsync(
            "v1/organizations/me/invitations",
            new { email = orgA.Owner.Email, role = "MEMBER" },
            orgB.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, invite.Status);
        var token = invite.Data.GetProperty("token").GetString();

        var response = await _api.PostAsync(
            "v1/invitations/accept",
            new { token },
            orgA.OwnerCookie);

        Assert.Equal(HttpStatusCode.Conflict, response.Status);
        Assert.Equal("ORG_011", response.ErrorCode);
    }
}
