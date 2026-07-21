namespace NodeScope.ContractTests.Fixtures;

/// <summary>
/// An organization minted for a single test, together with the fresh OWNER the
/// suite created for it. Provisioning a new org per test is what keeps the
/// ~100 Inventory/Monitoring endpoints isolated: each test owns its data, so one
/// test's devices/circuits/agents never leak into another's assertions.
/// </summary>
/// <param name="OrganizationId">The provisioned organization's id.</param>
/// <param name="Name">The name the org was created with.</param>
/// <param name="Owner">A signed-up user made OWNER of this org, with both credential forms.</param>
public sealed record ProvisionedOrg(string OrganizationId, string Name, UserSession Owner)
{
    /// <summary>Cookie authentication for the org's owner.</summary>
    public Auth OwnerCookie => Owner.AsCookie();

    /// <summary>Bearer authentication for the org's owner.</summary>
    public Auth OwnerBearer => Owner.AsBearer();
}

/// <summary>
/// Establishes the two things the org-scoped tests need that plain sign-up cannot
/// give them: a super-admin principal, and isolated organizations owned by fresh
/// users. Both are built the way a real operator would - over the admin HTTP
/// endpoints - with the lone exception of the super-admin grant, which the API
/// deliberately does not expose (see <see cref="SuperAdminGrant"/>).
/// </summary>
public static class OrgProvisioning
{
    /// <summary>
    /// Produces a signed-in super-admin session. Signs up an ordinary user, promotes
    /// it in the database, then signs in <em>afresh</em> so the returned session
    /// reflects the promotion - Better Auth's <c>cookieCache</c> would otherwise keep
    /// serving the pre-promotion user from the original sign-up session.
    /// </summary>
    public static async Task<UserSession> BootstrapSuperAdminAsync(
        ApiClient api,
        CancellationToken cancellationToken = default)
    {
        var email = AuthWorkflow.NewEmail("superadmin");
        await AuthWorkflow.SignUpAsync(api, email: email, name: "Contract Super Admin", cancellationToken: cancellationToken);
        await SuperAdminGrant.GrantAsync(email, cancellationToken);
        return await AuthWorkflow.SignInAsync(api, email, AuthWorkflow.DefaultPassword, cancellationToken);
    }

    /// <summary>
    /// Provisions a fresh, isolated organization owned by a brand-new user, using the
    /// super-admin admin endpoints exactly as an operator would: create the org, sign
    /// up the owner, then designate them. The returned owner's session works for
    /// org-scoped calls immediately - membership is resolved per-request from the
    /// database, not from the session - so no re-authentication is required.
    /// </summary>
    public static async Task<ProvisionedOrg> ProvisionOrgAsync(
        ApiClient api,
        UserSession superAdmin,
        string? name = null,
        CancellationToken cancellationToken = default)
    {
        name ??= $"Contract Org {Guid.NewGuid():N}";

        var create = await api.PostAsync("v1/admin/organizations", new { name }, superAdmin.AsCookie(), cancellationToken);
        Assert.Equal(HttpStatusCode.Created, create.Status);
        var organizationId = create.Data.GetProperty("id").GetString()
            ?? throw new InvalidOperationException("admin create-organization response carried no id");

        // designateOwner looks the user up by email and refuses one already in an org,
        // so the owner must be a fresh, org-less account.
        var owner = await AuthWorkflow.SignUpAsync(api, name: "Contract Org Owner", cancellationToken: cancellationToken);

        var designate = await api.PostAsync(
            $"v1/admin/organizations/{organizationId}/owner",
            new { email = owner.Email },
            superAdmin.AsCookie(),
            cancellationToken);
        Assert.Equal(HttpStatusCode.Created, designate.Status);

        return new ProvisionedOrg(organizationId, name, owner);
    }
}
