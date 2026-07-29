using NodeScope.Backup;
using Xunit;

namespace NodeScope.Backup.Tests;

public sealed class OffsiteIdentityTests
{
    [Fact]
    public void Exported_identity_is_self_contained_and_round_trips()
    {
        var identity = OffsiteIdentity.Generate();

        var parsed = OffsiteIdentity.Parse(identity.Export());

        Assert.Equal(identity, parsed);
    }

    [Fact]
    public void Identity_rejects_mismatched_public_and_private_keys()
    {
        var first = OffsiteIdentity.Generate();
        var second = OffsiteIdentity.Generate();
        var value = $"""
            NODESCOPE_OFFSITE_IDENTITY_V1
            PUBKEY={first.PublicKey}
            PRIVKEY={second.PrivateKey}
            """;

        Assert.Throws<FormatException>(() => OffsiteIdentity.Parse(value));
    }
}
