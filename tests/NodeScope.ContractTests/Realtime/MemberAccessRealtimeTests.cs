using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the direct member-site grants and the access:changed notification.
/// The grant/revoke events fan out to the granted site's scope rooms like any entity
/// event, but access:changed is different from everything else in the catalogue: it
/// targets the affected USER's own room, so it is the granted member's socket - not
/// the acting owner's - that must hear it, carrying the org id so the client knows
/// which org's access summary to refetch.
/// </summary>
[Collection(ContractSuite.Name)]
public class MemberAccessRealtimeTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public MemberAccessRealtimeTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_socket_receives_member_property_assigned_when_a_member_is_granted_a_site()
    {
        var (org, _, memberId, siteId) = await OrgWithMemberAndSiteAsync();

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var grant = await _api.PostAsync($"v1/members/{memberId}/properties", new { propertyId = siteId }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, grant.Status);

        var evt = await socket.WaitForEventAsync(
            "v1:member:property:assigned",
            p => p.TryGetProperty("memberId", out var m) && m.GetString() == memberId);
        Assert.Equal(siteId, evt.GetProperty("propertyId").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_member_property_unassigned_when_a_grant_is_revoked()
    {
        var (org, _, memberId, siteId) = await OrgWithMemberAndSiteAsync();
        var grant = await _api.PostAsync($"v1/members/{memberId}/properties", new { propertyId = siteId }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, grant.Status);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var revoke = await _api.DeleteAsync($"v1/members/{memberId}/properties/{siteId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NoContent, revoke.Status);

        var evt = await socket.WaitForEventAsync(
            "v1:member:property:unassigned",
            p => p.TryGetProperty("memberId", out var m) && m.GetString() == memberId);
        Assert.Equal(siteId, evt.GetProperty("propertyId").GetString());
    }

    [Fact]
    public async Task Member_socket_receives_access_changed_when_granted_a_site()
    {
        var (org, member, memberId, siteId) = await OrgWithMemberAndSiteAsync();

        // The MEMBER's socket - access:changed targets the affected user's room.
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(member.AsCookie());

        var grant = await _api.PostAsync($"v1/members/{memberId}/properties", new { propertyId = siteId }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, grant.Status);

        var evt = await socket.WaitForEventAsync("v1:access:changed");
        Assert.Equal(org.OrganizationId, evt.GetProperty("organizationId").GetString());
    }

    [Fact]
    public async Task Member_socket_receives_access_changed_when_added_to_a_team()
    {
        var (org, member, memberId, _) = await OrgWithMemberAndSiteAsync();
        var team = await _api.PostAsync("v1/teams", new { name = $"team-{Guid.NewGuid():N}" }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, team.Status);
        var teamId = InventoryScaffold.RequireId(team.Data);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(member.AsCookie());

        var add = await _api.PostAsync($"v1/teams/{teamId}/members", new { memberId }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, add.Status);

        var evt = await socket.WaitForEventAsync("v1:access:changed");
        Assert.Equal(org.OrganizationId, evt.GetProperty("organizationId").GetString());
    }

    /// <summary>An org with a genuine non-owner MEMBER (their org-member id resolved from
    /// the owner's members list) and a top-level SITE to grant.</summary>
    private async Task<(ProvisionedOrg Org, UserSession Member, string MemberId, string SiteId)> OrgWithMemberAndSiteAsync()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);

        var list = await _api.GetAsync("v1/organizations/me/members", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var memberId = list.Data.EnumerateArray()
                .Single(m => m.GetProperty("userId").GetString() == member.UserId)
                .GetProperty("id").GetString()
            ?? throw new InvalidOperationException("members list entry carried no id");

        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerCookie);
        return (org, member, memberId, InventoryScaffold.RequireId(site));
    }
}
