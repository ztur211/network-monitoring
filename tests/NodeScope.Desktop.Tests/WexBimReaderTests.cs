using System.Buffers.Binary;
using NodeScope.Desktop.Bim;
using NodeScope.Desktop.Tests.Fakes;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// Decoder coverage against xBIM's real v1 and v4 fixtures. This is deliberately
/// below the GL layer: malformed appliance content must fail deterministically
/// before any native graphics call or large GPU allocation occurs.
/// </summary>
public sealed class WexBimReaderTests
{
    [Fact]
    public void Version_4_cube_decodes_products_styles_normals_and_bounds()
    {
        var bytes = WexBimFixture.CubeA();

        var scene = WexBimReader.Read(bytes, TestContext.Current.CancellationToken);

        Assert.Equal(4, scene.FormatVersion);
        Assert.Equal(1000, scene.Meter);
        Assert.Equal(bytes.Length, scene.SourceSizeBytes);
        Assert.Equal(1, scene.ShapeCount);
        Assert.Equal(12, scene.TriangleCount);
        Assert.Single(scene.Geometries);
        Assert.Single(scene.Geometries[0].Instances);
        Assert.Single(scene.Products);
        Assert.Equal(36, scene.Geometries[0].VertexCount);
        Assert.Equal(1, scene.VisibleProductCount);
        Assert.False(scene.Bounds.IsEmpty);
        Assert.True(scene.Bounds.Size.X > 0);
        Assert.True(scene.Bounds.Size.Y > 0);
        Assert.True(scene.Bounds.Size.Z > 0);

        var vertices = scene.Geometries[0].Vertices;
        for (var offset = 0; offset < vertices.Length; offset += BimGeometry.FloatsPerVertex)
        {
            var normalLength = MathF.Sqrt(
                (vertices[offset + 3] * vertices[offset + 3])
                + (vertices[offset + 4] * vertices[offset + 4])
                + (vertices[offset + 5] * vertices[offset + 5]));
            Assert.InRange(normalLength, 0.999f, 1.001f);
        }
    }

    [Fact]
    public void Version_1_repetitions_share_geometry_and_keep_both_transforms()
    {
        var scene = WexBimReader.Read(
            WexBimFixture.TwoProxy(),
            TestContext.Current.CancellationToken);

        var geometry = Assert.Single(scene.Geometries);
        Assert.Equal(1, scene.FormatVersion);
        Assert.Equal(24, scene.TriangleCount);
        Assert.Equal(12, geometry.TriangleCount);
        Assert.Equal(2, geometry.Instances.Count);
        Assert.Equal(2, scene.Products.Count);
        Assert.NotEqual(geometry.Instances[0].Transform, geometry.Instances[1].Transform);
        Assert.Equal(2, scene.VisibleProductCount);
        Assert.False(scene.Bounds.IsEmpty);
    }

    [Fact]
    public void Truncated_geometry_fails_with_a_field_specific_format_error()
    {
        var bytes = WexBimFixture.CubeA()[..^7];

        var error = Assert.Throws<InvalidDataException>(
            () => WexBimReader.Read(bytes, TestContext.Current.CancellationToken));

        Assert.StartsWith("Invalid wexBIM file:", error.Message, StringComparison.Ordinal);
        Assert.Contains("geometry byte length", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Wrong_magic_is_rejected_before_header_allocation()
    {
        var bytes = WexBimFixture.CubeA();
        BinaryPrimitives.WriteInt32LittleEndian(bytes, 42);

        var error = Assert.Throws<InvalidDataException>(
            () => WexBimReader.Read(bytes, TestContext.Current.CancellationToken));

        Assert.Contains("magic number", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Declared_shape_totals_must_match_the_payload()
    {
        var bytes = WexBimFixture.CubeA();
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(5), 2);

        var error = Assert.Throws<InvalidDataException>(
            () => WexBimReader.Read(bytes, TestContext.Current.CancellationToken));

        Assert.Contains("declares 2 shapes", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Cancellation_is_observed_while_decoding()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

#pragma warning disable xUnit1051 // This test intentionally supplies its already-canceled token.
        Assert.Throws<OperationCanceledException>(
            () => WexBimReader.Read(WexBimFixture.CubeA(), cancellation.Token));
#pragma warning restore xUnit1051
    }
}
