using System.Numerics;
using NodeScope.Desktop.Bim;
using NodeScope.Desktop.Tests.Fakes;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class BimInteractionTests
{
    [Fact]
    public void Center_ray_returns_an_exact_product_surface_hit()
    {
        var scene = Scene();
        var camera = new BimCamera();
        camera.Fit(scene.Bounds);
        var picker = new BimPicker(scene);

        var hit = picker.Pick(
            camera.CreateRay(256, 256, 512, 512),
            BimRenderOptions.Empty);

        Assert.NotNull(hit);
        Assert.Equal(BimPickKind.Product, hit.Kind);
        Assert.Equal(scene.Products.Keys.Single(), hit.ProductLabel);
        Assert.True(hit.Distance > 0);
        Assert.True(float.IsFinite(hit.Point.X));
        Assert.InRange(hit.Normal.Length(), 0.999f, 1.001f);
    }

    [Fact]
    public void Hidden_and_isolated_products_are_removed_from_picking()
    {
        var scene = Scene();
        var camera = new BimCamera();
        camera.Fit(scene.Bounds);
        var picker = new BimPicker(scene);
        var label = scene.Products.Keys.Single();
        var ray = camera.CreateRay(256, 256, 512, 512);

        var hidden = BimRenderOptions.Empty with
        {
            HiddenProductLabels = new HashSet<int> { label },
        };
        var isolatedElsewhere = BimRenderOptions.Empty with
        {
            IsolatedProductLabel = label + 1,
        };

        Assert.Null(picker.Pick(ray, hidden));
        Assert.Null(picker.Pick(ray, isolatedElsewhere));
        Assert.NotNull(picker.Pick(
            ray,
            BimRenderOptions.Empty with { IsolatedProductLabel = label }));
    }

    [Fact]
    public void Section_plane_clips_the_cpu_projection_and_picker_consistently()
    {
        var scene = Scene();
        var camera = new BimCamera();
        camera.Fit(scene.Bounds);
        var picker = new BimPicker(scene);
        var fullyClipped = BimRenderOptions.Empty with
        {
            Section = new BimSectionPlane(
                true,
                BimSectionAxis.Z,
                scene.Bounds.Min.Z - 1f),
        };

        var projected = BimSceneProjector.Project(
            scene,
            camera,
            512,
            512,
            fullyClipped,
            1000);
        var hit = picker.Pick(
            camera.CreateRay(256, 256, 512, 512),
            fullyClipped);

        Assert.Empty(projected);
        Assert.Null(hit);
    }

    [Fact]
    public void Device_meshes_render_and_take_part_in_nearest_hit_testing()
    {
        var scene = Scene();
        var camera = new BimCamera();
        camera.Fit(scene.Bounds);
        var position = scene.Bounds.Center;
        var options = BimRenderOptions.Empty with
        {
            Devices =
            [
                new BimDeviceVisual(
                    "device-1",
                    "Core switch",
                    "SWITCH",
                    position,
                    "DOWN",
                    1,
                    "Level 1"),
            ],
        };

        var meshes = BimDeviceMeshes.Build(scene, options);
        var projected = BimSceneProjector.Project(
            scene,
            camera,
            512,
            512,
            options,
            10_000);
        var hit = new BimPicker(scene).Pick(
            camera.CreateRay(256, 256, 512, 512),
            options);

        Assert.Single(meshes);
        Assert.NotEmpty(projected);
        Assert.NotNull(hit);
        Assert.Equal(BimPickKind.Device, hit.Kind);
        Assert.Equal("device-1", hit.DeviceId);
    }

    [Fact]
    public void Bcf_camera_restore_preserves_a_finite_view_and_center_ray()
    {
        var scene = Scene();
        var camera = new BimCamera();
        camera.Fit(scene.Bounds);
        var before = camera.Snapshot(16d / 9d);

        camera.SetView(
            before.Eye + new Vector3(10, -5, 2),
            before.Direction,
            before.Up,
            62f);

        var restored = camera.Snapshot(16d / 9d);
        var ray = camera.CreateRay(640, 360, 1280, 720);
        Assert.InRange(restored.FieldOfViewDegrees, 61.99f, 62.01f);
        Assert.InRange(Vector3.Dot(ray.Direction, restored.Direction), 0.999f, 1.001f);
        Assert.True(float.IsFinite(restored.Eye.X));
    }

    private static BimScene Scene() =>
        WexBimReader.Read(
            WexBimFixture.CubeA(),
            TestContext.Current.CancellationToken);
}
