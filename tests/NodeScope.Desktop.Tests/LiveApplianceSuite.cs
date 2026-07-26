using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// One collection for every env-gated live E2E: they all mutate the SAME appliance
/// (create/delete devices, flip SNMP assignments, submit metrics), so running them in
/// parallel lets one test's fleet churn invalidate another's picks - the settings
/// flow assigns to the first fleet device, which a concurrent realtime test may be
/// about to delete. Same-collection classes run sequentially; each test still runs
/// alone against a quiet appliance.
/// </summary>
[CollectionDefinition(Name)]
public sealed class LiveApplianceSuite
{
    public const string Name = "LiveApplianceE2E";
}
