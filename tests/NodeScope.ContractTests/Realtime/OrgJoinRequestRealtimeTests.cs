namespace NodeScope.ContractTests.Realtime;

/// <summary>
/// Contract for the join-request events (created / decided), the domain-matched way
/// into an org. A join request needs an org that has claimed the requester's email
/// domain (a super-admin operation), so each test claims a unique throwaway domain.
/// The submit response deliberately carries no body (<c>data: null</c>), so the request
/// id is correlated through the owner-side surfaces: the created event itself and the
/// pending list. Approval is the second emit path for member:added (the first, the
/// invitation accept, is covered elsewhere); denial must decide without admitting.
/// </summary>
[Collection(ContractSuite.Name)]
public class OrgJoinRequestRealtimeTests
{
    private static readonly TimeSpan NegativeWindow = TimeSpan.FromSeconds(2);

    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public OrgJoinRequestRealtimeTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Owner_socket_receives_join_request_created_when_a_user_requests_to_join()
    {
        var (org, requester) = await OrgWithDomainRequesterAsync();
        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var submit = await _api.PostAsync("v1/join-requests", auth: requester.AsCookie());
        Assert.Equal(HttpStatusCode.Created, submit.Status);

        var evt = await socket.WaitForEventAsync("v1:org:joinRequest:created", p => UserIdIs(p, requester.UserId));
        var requestId = evt.GetProperty("id").GetString();
        Assert.False(string.IsNullOrEmpty(requestId));

        // The id the event announced must be the one the owner's pending list serves.
        Assert.Equal(requestId, await PendingRequestIdAsync(org, requester.UserId));
    }

    [Fact]
    public async Task Approving_a_join_request_emits_decided_and_member_added()
    {
        var (org, requester) = await OrgWithDomainRequesterAsync();
        var submit = await _api.PostAsync("v1/join-requests", auth: requester.AsCookie());
        Assert.Equal(HttpStatusCode.Created, submit.Status);
        var requestId = await PendingRequestIdAsync(org, requester.UserId);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var approve = await _api.PostAsync($"v1/organizations/me/join-requests/{requestId}/approve", auth: org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, approve.Status);

        var decided = await socket.WaitForEventAsync("v1:org:joinRequest:decided", p => IdIs(p, requestId));
        Assert.True(decided.GetProperty("approved").GetBoolean());

        // Approval admits the requester, over the join-request emit path rather than the
        // invitation accept - the org room must hear member:added from both.
        var added = await socket.WaitForEventAsync("v1:org:member:added", p => UserIdIs(p, requester.UserId));
        Assert.Equal("MEMBER", added.GetProperty("role").GetString());
    }

    [Fact]
    public async Task Denying_a_join_request_emits_decided_without_member_added()
    {
        var (org, requester) = await OrgWithDomainRequesterAsync();
        var submit = await _api.PostAsync("v1/join-requests", auth: requester.AsCookie());
        Assert.Equal(HttpStatusCode.Created, submit.Status);
        var requestId = await PendingRequestIdAsync(org, requester.UserId);

        await using var socket = await RealtimeScaffold.ConnectReadyAsync(org.OwnerCookie);

        var deny = await _api.PostAsync($"v1/organizations/me/join-requests/{requestId}/deny", auth: org.OwnerCookie);
        Assert.Equal(HttpStatusCode.Created, deny.Status);

        var decided = await socket.WaitForEventAsync("v1:org:joinRequest:decided", p => IdIs(p, requestId));
        Assert.False(decided.GetProperty("approved").GetBoolean());

        await Assert.ThrowsAsync<TimeoutException>(
            () => socket.WaitForEventAsync("v1:org:member:added", p => UserIdIs(p, requester.UserId), NegativeWindow));
    }

    /// <summary>
    /// An org that has claimed a unique throwaway domain, plus a signed-up org-less user
    /// whose email is on that domain - the only principal who can submit a join request.
    /// </summary>
    private async Task<(ProvisionedOrg Org, UserSession Requester)> OrgWithDomainRequesterAsync()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var superAdmin = await _fixture.SuperAdminAsync();
        var domain = $"jr-{Guid.NewGuid():N}.test";

        var claim = await _api.PostAsync(
            $"v1/admin/organizations/{org.OrganizationId}/domains",
            new { domain },
            superAdmin.AsCookie());
        Assert.Equal(HttpStatusCode.Created, claim.Status);

        var requester = await AuthWorkflow.SignUpAsync(
            _api,
            email: $"joiner-{Guid.NewGuid():N}@{domain}",
            name: "Contract Join Requester");
        return (org, requester);
    }

    private async Task<string> PendingRequestIdAsync(ProvisionedOrg org, string userId)
    {
        var list = await _api.GetAsync("v1/organizations/me/join-requests", org.OwnerCookie);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var request = list.Data.EnumerateArray().Single(r => r.GetProperty("userId").GetString() == userId);
        Assert.Equal("PENDING", request.GetProperty("status").GetString());
        return request.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("pending join request carried no id");
    }

    private static bool IdIs(JsonElement payload, string id) =>
        payload.TryGetProperty("id", out var i) && i.GetString() == id;

    private static bool UserIdIs(JsonElement payload, string userId) =>
        payload.TryGetProperty("userId", out var u) && u.GetString() == userId;
}
