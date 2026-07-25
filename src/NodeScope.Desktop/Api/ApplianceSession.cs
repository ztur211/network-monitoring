namespace NodeScope.Desktop.Api;

/// <summary>
/// An authenticated appliance connection: the client plus the Bearer credential every
/// call needs. Published by the auth flow while (and only while) a user is signed in.
/// </summary>
internal sealed record ApplianceSession(IApplianceClient Client, string Token);
