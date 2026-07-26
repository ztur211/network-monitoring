namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the invitation lifecycle events (created / revoked / accepted). Like the
/// member events, they fan out to the whole org room rather than a scope or owner room,
/// so the OWNER socket observes each step of an invitation another admin might be
/// driving. The accepted event is asserted alongside the full HTTP accept flow - the
/// same emit path that produces the already-covered member:added.
/// </summary>
[Collection(ContractSuite.Name)]
public class OrgInvitationRealtimeTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public OrgInvitationRealtimeTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_socket_receives_invitation_created_when_an_invitation_is_issued()
    {
        var org = await _fixture.ProvisionOrgAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        // The service normalizes the invited email (trim + lowercase) before persisting,
        // and the event must carry the normalized form - not what the caller typed.
        var nonce = Guid.NewGuid().ToString("N");
        var typedEmail = $"Invitee-{nonce}@Example.COM";
        var normalizedEmail = $"invitee-{nonce}@example.com";
        var invite = await _api.PostAsync(
            "v1/organizations/me/invitations",
            new { email = typedEmail, role = "MEMBER" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, invite.Status);
        var invitationId = RequireInvitationId(invite);

        var evt = await socket.WaitForEventAsync("v1:org:invitation:created", p => IdIs(p, invitationId));
        Assert.Equal(normalizedEmail, evt.GetProperty("email").GetString());
        Assert.True(evt.TryGetProperty("timestamp", out _));
    }

    [Fact]
    public async Task Owner_socket_receives_invitation_revoked_when_an_invitation_is_revoked()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var invite = await _api.PostAsync(
            "v1/organizations/me/invitations",
            new { email = AuthWorkflow.NewEmail("invitee"), role = "MEMBER" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, invite.Status);
        var invitationId = RequireInvitationId(invite);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        var revoke = await _api.DeleteAsync($"v1/organizations/me/invitations/{invitationId}", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, revoke.Status);

        var evt = await socket.WaitForEventAsync("v1:org:invitation:revoked", p => IdIs(p, invitationId));
        Assert.Equal(invitationId, evt.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_invitation_accepted_when_an_invitation_is_accepted()
    {
        var org = await _fixture.ProvisionOrgAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerAuth);

        // The full accept flow inline (rather than OrgProvisioning.AddMemberAsync) so the
        // invitation id is in hand to correlate with the event.
        var email = AuthWorkflow.NewEmail("invitee");
        var invite = await _api.PostAsync(
            "v1/organizations/me/invitations",
            new { email, role = "MEMBER" },
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, invite.Status);
        var invitationId = RequireInvitationId(invite);
        var token = invite.Data.GetProperty("token").GetString();

        var invitee = await AuthWorkflow.SignUpAsync(_api, email: email, name: "Contract Invitee");
        var accept = await _api.PostAsync("v1/invitations/accept", new { token }, invitee.AsBearer());
        Assert.Equal(HttpStatusCode.Created, accept.Status);

        var evt = await socket.WaitForEventAsync("v1:org:invitation:accepted", p => IdIs(p, invitationId));
        Assert.Equal(invitee.UserId, evt.GetProperty("userId").GetString());
    }

    private static string RequireInvitationId(ApiResponse invite) =>
        invite.Data.GetProperty("invitation").GetProperty("id").GetString()
            ?? throw new InvalidOperationException("invitation response carried no invitation.id");

    private static bool IdIs(JsonElement payload, string id) =>
        payload.TryGetProperty("id", out var i) && i.GetString() == id;
}
