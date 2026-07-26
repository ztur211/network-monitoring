namespace NodeScope.ContractTests.Identity;

/// <summary>
/// Contract for the join-request error envelopes and the status-filtered list.
/// Submission is domain-driven: no org claims the email's domain (ORG_014), the
/// user already belongs somewhere (ORG_011), or a request is already pending
/// (ORG_015). Deciding an unknown or already-decided request is ORG_012, and the
/// list defaults to PENDING while honoring an explicit ?status= filter.
/// </summary>
[Collection(ContractSuite.Name)]
public class JoinRequestsContractTests
{
    private readonly ContractApiFixture _fixture;
    private readonly ApiClient _api;

    public JoinRequestsContractTests(ContractApiFixture fixture)
    {
        _fixture = fixture;
        _api = fixture.Api;
    }

    [Fact]
    public async Task Submit_with_an_unclaimed_domain_is_404_ORG_014()
    {
        // example.com is never claimed by any provisioned org.
        var user = await AuthWorkflow.SignUpAsync(_api);

        var response = await _api.PostAsync("v1/join-requests", auth: user.AsBearer());

        Assert.Equal(HttpStatusCode.NotFound, response.Status);
        Assert.Equal("ORG_014", response.ErrorCode);
    }

    [Fact]
    public async Task Submit_while_already_a_member_is_409_ORG_011()
    {
        var org = await _fixture.ProvisionOrgAsync();

        var response = await _api.PostAsync("v1/join-requests", auth: org.OwnerAuth);

        Assert.Equal(HttpStatusCode.Conflict, response.Status);
        Assert.Equal("ORG_011", response.ErrorCode);
    }

    [Fact]
    public async Task A_second_pending_submission_is_409_ORG_015()
    {
        var (_, requester) = await OrgWithDomainRequesterAsync();

        var first = await _api.PostAsync("v1/join-requests", auth: requester.AsBearer());
        Assert.Equal(HttpStatusCode.Created, first.Status);

        var second = await _api.PostAsync("v1/join-requests", auth: requester.AsBearer());
        Assert.Equal(HttpStatusCode.Conflict, second.Status);
        Assert.Equal("ORG_015", second.ErrorCode);
    }

    [Fact]
    public async Task List_defaults_to_PENDING_and_honors_an_explicit_status_filter()
    {
        var (org, requester) = await OrgWithDomainRequesterAsync();
        var submit = await _api.PostAsync("v1/join-requests", auth: requester.AsBearer());
        Assert.Equal(HttpStatusCode.Created, submit.Status);

        var pending = await _api.GetAsync("v1/organizations/me/join-requests", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, pending.Status);
        var request = pending.Data.EnumerateArray()
            .Single(r => r.GetProperty("userId").GetString() == requester.UserId);
        Assert.Equal("PENDING", request.GetProperty("status").GetString());
        Assert.Equal(requester.Email, request.GetProperty("email").GetString());
        Assert.Equal("Contract Join Requester", request.GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, request.GetProperty("decidedAt").ValueKind);
        var requestId = request.GetProperty("id").GetString();

        var deny = await _api.PostAsync(
            $"v1/organizations/me/join-requests/{requestId}/deny",
            auth: org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, deny.Status);

        // Decided: gone from the default view, present under its status.
        var pendingAfter = await _api.GetAsync("v1/organizations/me/join-requests", org.OwnerAuth);
        Assert.DoesNotContain(
            pendingAfter.Data.EnumerateArray(),
            r => r.GetProperty("id").GetString() == requestId);

        var denied = await _api.GetAsync(
            "v1/organizations/me/join-requests?status=DENIED",
            org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, denied.Status);
        var deniedRow = denied.Data.EnumerateArray()
            .Single(r => r.GetProperty("id").GetString() == requestId);
        Assert.Equal("DENIED", deniedRow.GetProperty("status").GetString());
        Assert.False(string.IsNullOrEmpty(deniedRow.GetProperty("decidedAt").GetString()));
    }

    [Fact]
    public async Task Deciding_an_unknown_or_already_decided_request_is_404_ORG_012()
    {
        var (org, requester) = await OrgWithDomainRequesterAsync();

        var unknown = await _api.PostAsync(
            $"v1/organizations/me/join-requests/{Guid.NewGuid()}/approve",
            auth: org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, unknown.Status);
        Assert.Equal("ORG_012", unknown.ErrorCode);

        // Deny a real one, then try to approve it - decided requests are spent.
        var submit = await _api.PostAsync("v1/join-requests", auth: requester.AsBearer());
        Assert.Equal(HttpStatusCode.Created, submit.Status);
        var requestId = await PendingRequestIdAsync(org, requester.UserId);

        var deny = await _api.PostAsync(
            $"v1/organizations/me/join-requests/{requestId}/deny",
            auth: org.OwnerAuth);
        Assert.Equal(HttpStatusCode.Created, deny.Status);

        var approveAfter = await _api.PostAsync(
            $"v1/organizations/me/join-requests/{requestId}/approve",
            auth: org.OwnerAuth);
        Assert.Equal(HttpStatusCode.NotFound, approveAfter.Status);
        Assert.Equal("ORG_012", approveAfter.ErrorCode);
    }

    /// <summary>An org that claimed a unique throwaway domain plus an org-less user on it.</summary>
    private async Task<(ProvisionedOrg Org, UserSession Requester)> OrgWithDomainRequesterAsync()
    {
        var org = await _fixture.ProvisionOrgAsync();
        var superAdmin = await _fixture.SuperAdminAsync();
        var domain = $"jrc-{Guid.NewGuid():N}.test";

        var claim = await _api.PostAsync(
            $"v1/admin/organizations/{org.OrganizationId}/domains",
            new { domain },
            superAdmin.AsBearer());
        Assert.Equal(HttpStatusCode.Created, claim.Status);

        var requester = await AuthWorkflow.SignUpAsync(
            _api,
            email: $"joiner-{Guid.NewGuid():N}@{domain}",
            name: "Contract Join Requester");
        return (org, requester);
    }

    private async Task<string> PendingRequestIdAsync(ProvisionedOrg org, string userId)
    {
        var list = await _api.GetAsync("v1/organizations/me/join-requests", org.OwnerAuth);
        Assert.Equal(HttpStatusCode.OK, list.Status);
        var request = list.Data.EnumerateArray().Single(r => r.GetProperty("userId").GetString() == userId);
        return request.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("pending join request carried no id");
    }
}
