using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NodeScope.Modules.Identity.Infrastructure.Persistence;
using NodeScope.Platform.Abstractions;
using NodeScope.Platform.Audit;
using NodeScope.Platform.Http;

namespace NodeScope.Modules.Identity.Infrastructure.Auth;

/// <summary>Scheme constants for the hand-rolled session authentication (Decision 7).</summary>
public static class SessionAuthenticationDefaults
{
    public const string SchemeName = "Session";

    /// <summary>Claim carrying <c>User.isSuperAdmin</c>, which gates the org-provisioning routes.</summary>
    public const string SuperAdminClaim = "nodescope:superAdmin";
}

/// <summary>
/// Decision 7: the hand-rolled session authenticator over the existing <c>Session</c> table.
/// The credential is the raw session token as a Bearer header (native wire, 2026-07-26 -
/// the cookie and HMAC forms died with the Better Auth shim). One indexed lookup per
/// request, no cookie cache (revocation is immediate by design). On success it also
/// resolves the requester's org membership into <see cref="OrgContextHolder"/>, folding
/// the Node API's <c>AuthGuard</c> + <c>OrgContextGuard</c> pair into one place.
/// </summary>
/// <remarks>
/// Sliding refresh (<c>updateAge</c>): any authenticated request extends a session's
/// expiry once it is more than 24 hours old - a cheap due-check on the already-loaded
/// expiry, one UPDATE when it fires.
/// </remarks>
internal sealed class SessionAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    private readonly IdentityDbContext _db;
    private readonly IOrgMembershipResolver _members;
    private readonly OrgContextHolder _orgContext;
    private readonly AuditContext _auditContext;

    public SessionAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        IdentityDbContext db,
        IOrgMembershipResolver members,
        OrgContextHolder orgContext,
        AuditContext auditContext)
        : base(options, logger, encoder)
    {
        _db = db;
        _members = members;
        _orgContext = orgContext;
        _auditContext = auditContext;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var token = SessionPolicy.ExtractBearer(Request);
        if (token is null)
        {
            return AuthenticateResult.NoResult();
        }

        var now = DateTime.UtcNow;
        var session = await _db.Sessions
            .Where(row => row.Token == token && row.ExpiresAt > now)
            .Join(
                _db.Users,
                row => row.UserId,
                user => user.Id,
                (row, user) => new { user.Id, user.IsSuperAdmin, row.ExpiresAt })
            .FirstOrDefaultAsync(Context.RequestAborted);
        if (session is null)
        {
            return AuthenticateResult.NoResult();
        }

        if (SessionPolicy.RefreshDue(session.ExpiresAt, now))
        {
            var refreshedExpiry = now + SessionPolicy.SessionTtl;
            await _db.Sessions
                .Where(row => row.Token == token)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(row => row.ExpiresAt, refreshedExpiry)
                        .SetProperty(row => row.UpdatedAt, now),
                    Context.RequestAborted);
        }

        var userId = session.Id;
        _auditContext.UserId = userId;
        _orgContext.OrgMember = await _members.ForUserAsync(userId, Context.RequestAborted);

        // isSuperAdmin rides on the ticket because the admin routes gate on it and nothing
        // else in the request pipeline would otherwise read the User row.
        var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, userId) };
        if (session.IsSuperAdmin)
        {
            claims.Add(new Claim(SessionAuthenticationDefaults.SuperAdminClaim, "true"));
        }

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        return AuthenticateResult.Success(
            new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        return Response.WriteAsJsonAsync(
            new ApiErrorEnvelope(false, new ApiErrorBody("AUTH_002", "SESSION_INVALID", null), IsoTimestamp.Now()),
            Context.RequestAborted);
    }

    protected override Task HandleForbiddenAsync(AuthenticationProperties properties)
    {
        var reason = Context.Items.TryGetValue(OrgAuthorization.FailureItemKey, out var value)
            ? value as string
            : null;
        var (code, message) = reason switch
        {
            OrgAuthorization.InsufficientRole => (OrgAuthorization.InsufficientRole, "INSUFFICIENT_ORG_ROLE"),
            SuperAdminAuthorization.NotSuperAdmin => (SuperAdminAuthorization.NotSuperAdmin, "NOT_A_SUPER_ADMIN"),
            _ => (OrgAuthorization.NotAnOrgMember, "NOT_AN_ORG_MEMBER"),
        };

        Response.StatusCode = StatusCodes.Status403Forbidden;
        return Response.WriteAsJsonAsync(
            new ApiErrorEnvelope(false, new ApiErrorBody(code, message, null), IsoTimestamp.Now()),
            Context.RequestAborted);
    }

}
