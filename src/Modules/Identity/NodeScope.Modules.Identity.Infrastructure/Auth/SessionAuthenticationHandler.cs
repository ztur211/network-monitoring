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
}

/// <summary>Options for <see cref="SessionAuthenticationHandler"/>.</summary>
public sealed class SessionAuthenticationOptions : AuthenticationSchemeOptions
{
    /// <summary>The Better Auth HMAC secret (<c>BETTER_AUTH_SECRET</c>), shared with the Node stack.</summary>
    public string Secret { get; set; } = string.Empty;
}

/// <summary>
/// Decision 7: the hand-rolled session authenticator over the existing <c>Session</c> table.
/// One indexed lookup per request, no cookie cache (revocation is immediate by design). On
/// success it also resolves the requester's org membership into <see cref="OrgContextHolder"/>,
/// folding the Node API's <c>AuthGuard</c> + <c>OrgContextGuard</c> pair into one place.
/// Challenge and forbid responses write the Node error envelope verbatim.
/// </summary>
/// <remarks>
/// Deliberate deviation, recorded in the decision log: Better Auth's sliding refresh
/// (<c>updateAge</c>) is not applied here. During the transition the Node side still serves
/// <c>/api/auth/*</c> and refreshes sessions; the C# side only validates. Revisit at the
/// Identity endpoint port.
/// </remarks>
internal sealed class SessionAuthenticationHandler : AuthenticationHandler<SessionAuthenticationOptions>
{
    private readonly IdentityDbContext _db;
    private readonly IOrgMembershipResolver _members;
    private readonly OrgContextHolder _orgContext;
    private readonly AuditContext _auditContext;

    public SessionAuthenticationHandler(
        IOptionsMonitor<SessionAuthenticationOptions> options,
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
        var token = SessionTokenCodec.Extract(Request, Options.Secret);
        if (token is null)
        {
            return AuthenticateResult.NoResult();
        }

        var now = DateTime.UtcNow;
        var userId = await _db.Sessions
            .Where(session => session.Token == token && session.ExpiresAt > now)
            .Select(session => session.UserId)
            .FirstOrDefaultAsync(Context.RequestAborted);
        if (userId is null)
        {
            return AuthenticateResult.NoResult();
        }

        _auditContext.UserId = userId;
        _orgContext.OrgMember = await _members.ForUserAsync(userId, Context.RequestAborted);

        var identity = new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, userId)],
            Scheme.Name);
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
        var (code, message) = reason == OrgAuthorization.InsufficientRole
            ? (OrgAuthorization.InsufficientRole, "INSUFFICIENT_ORG_ROLE")
            : (OrgAuthorization.NotAnOrgMember, "NOT_AN_ORG_MEMBER");

        Response.StatusCode = StatusCodes.Status403Forbidden;
        return Response.WriteAsJsonAsync(
            new ApiErrorEnvelope(false, new ApiErrorBody(code, message, null), IsoTimestamp.Now()),
            Context.RequestAborted);
    }

}
