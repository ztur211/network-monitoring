using NodeScope.ContractTests.Inventory;

namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the team lifecycle events. A fresh team governs no sites, so
/// team:created fans out through an empty scope list - owner-room-only, like the first
/// network - while the rest of the lifecycle (updated / deleted / member added +
/// removed / property assigned + unassigned) fans out to the team's governing sites.
/// The OWNER socket sees all of it. Team membership speaks org-member ids (not user
/// ids), resolved through the owner's members list the way a real client would.
/// </summary>
[Collection(ContractSuite.Name)]
public class TeamRealtimeTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public TeamRealtimeTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_socket_receives_team_created_when_a_team_is_created()
    {
        var org = await _fixture.ProvisionOrgAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var team = await CreateTeamAsync(org.OwnerCookie);
        var teamId = InventoryScaffold.RequireId(team);

        var evt = await socket.WaitForEventAsync("v1:team:created", p => IdIs(p, teamId));
        Assert.Equal(teamId, evt.GetProperty("id").GetString());
        // Unlike the entity events, the whole team/assignment family is emitted straight
        // through the gateway rather than the conflict service that stamps `timestamp`,
        // so its payloads are bare. Pinned here once for the family.
        Assert.False(evt.TryGetProperty("timestamp", out _));
    }

    [Fact]
    public async Task Owner_socket_receives_team_updated_when_a_team_is_renamed()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var team = await CreateTeamAsync(org.OwnerCookie);
        var teamId = InventoryScaffold.RequireId(team);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        // Team rename is a flat versioned body, not the changeset envelope entities use.
        var rename = await _api.PatchAsync(
            $"v1/teams/{teamId}",
            new { baseVersion = team.GetProperty("version").GetInt32(), name = $"team-{Guid.NewGuid():N}" },
            org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, rename.Status);

        var evt = await socket.WaitForEventAsync("v1:team:updated", p => IdIs(p, teamId));
        Assert.Equal(teamId, evt.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_team_deleted_when_a_team_is_deleted()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var team = await CreateTeamAsync(org.OwnerCookie);
        var teamId = InventoryScaffold.RequireId(team);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var delete = await _api.DeleteAsync($"v1/teams/{teamId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NoContent, delete.Status);

        var evt = await socket.WaitForEventAsync("v1:team:deleted", p => IdIs(p, teamId));
        Assert.Equal(teamId, evt.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_team_member_added_when_a_member_joins_a_team()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        var memberId = await OrgMemberIdAsync(org, member.UserId);
        var team = await CreateTeamAsync(org.OwnerCookie);
        var teamId = InventoryScaffold.RequireId(team);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var add = await _api.PostAsync($"v1/teams/{teamId}/members", new { memberId }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, add.Status);

        var evt = await socket.WaitForEventAsync(
            "v1:team:member:added",
            p => p.TryGetProperty("memberId", out var m) && m.GetString() == memberId);
        Assert.Equal(teamId, evt.GetProperty("teamId").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_team_member_removed_when_a_member_leaves_a_team()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var member = await OrgProvisioning.AddMemberAsync(_api, org);
        var memberId = await OrgMemberIdAsync(org, member.UserId);
        var team = await CreateTeamAsync(org.OwnerCookie);
        var teamId = InventoryScaffold.RequireId(team);
        var add = await _api.PostAsync($"v1/teams/{teamId}/members", new { memberId }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, add.Status);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var remove = await _api.DeleteAsync($"v1/teams/{teamId}/members/{memberId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NoContent, remove.Status);

        var evt = await socket.WaitForEventAsync(
            "v1:team:member:removed",
            p => p.TryGetProperty("memberId", out var m) && m.GetString() == memberId);
        Assert.Equal(teamId, evt.GetProperty("teamId").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_team_property_assigned_when_a_site_is_assigned()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerCookie);
        var siteId = InventoryScaffold.RequireId(site);
        var team = await CreateTeamAsync(org.OwnerCookie);
        var teamId = InventoryScaffold.RequireId(team);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var assign = await _api.PostAsync($"v1/teams/{teamId}/properties", new { propertyId = siteId }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, assign.Status);

        var evt = await socket.WaitForEventAsync(
            "v1:team:property:assigned",
            p => p.TryGetProperty("propertyId", out var pid) && pid.GetString() == siteId);
        Assert.Equal(teamId, evt.GetProperty("teamId").GetString());
    }

    [Fact]
    public async Task Owner_socket_receives_team_property_unassigned_when_a_site_is_unassigned()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var site = await InventoryScaffold.CreatePropertyAsync(_api, org.OwnerCookie);
        var siteId = InventoryScaffold.RequireId(site);
        var team = await CreateTeamAsync(org.OwnerCookie);
        var teamId = InventoryScaffold.RequireId(team);
        var assign = await _api.PostAsync($"v1/teams/{teamId}/properties", new { propertyId = siteId }, org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, assign.Status);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var unassign = await _api.DeleteAsync($"v1/teams/{teamId}/properties/{siteId}", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.NoContent, unassign.Status);

        var evt = await socket.WaitForEventAsync(
            "v1:team:property:unassigned",
            p => p.TryGetProperty("propertyId", out var pid) && pid.GetString() == siteId);
        Assert.Equal(teamId, evt.GetProperty("teamId").GetString());
    }

    private async Task<JsonElement> CreateTeamAsync(Auth auth)
    {
        var response = await _api.PostAsync("v1/teams", new { name = $"team-{Guid.NewGuid():N}" }, auth);
        Assert.Equal(HttpStatusCode.Created, response.Status);
        return response.Data;
    }

    /// <summary>Resolves a user's org-member id from the owner's members list - the id
    /// the team-membership surface speaks, distinct from the user id.</summary>
    private async Task<string> OrgMemberIdAsync(ProvisionedOrg org, string userId)
    {
        var list = await _api.GetAsync("v1/organizations/me/members", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var member = list.Data.EnumerateArray().Single(m => m.GetProperty("userId").GetString() == userId);
        return member.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("members list entry carried no id");
    }

    private static bool IdIs(JsonElement payload, string id) =>
        payload.TryGetProperty("id", out var i) && i.GetString() == id;
}
