using System.Numerics;
using Microsoft.Extensions.Logging.Abstractions;
using NodeScope.Contracts;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Bim;
using NodeScope.Desktop.Tests.Fakes;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

public sealed class BimViewerViewModelTests : IDisposable
{
    private static readonly Uri Server = new("https://appliance.local/");

    private readonly FakeApplianceClient _client = new(Server);
    private readonly FakeIfcTessellator _tessellator = new();
    private BimViewerViewModel? _viewModel;

    public void Dispose()
    {
        _viewModel?.Dispose();
        _client.Dispose();
    }

    [Fact]
    public async Task Construction_defers_appliance_work_until_the_viewer_is_opened()
    {
        _viewModel = new BimViewerViewModel(
            new ApplianceSession(_client, "token-1"),
            NullLogger<BimViewerViewModel>.Instance,
            _tessellator);

        Assert.Null(_client.LastBearerToken);
        Assert.Equal(BimViewerState.Loading, _viewModel.State);

        await _viewModel.Initialization;

        Assert.Equal("token-1", _client.LastBearerToken);
        Assert.Equal(BimViewerState.NoBuildings, _viewModel.State);
    }

    [Fact]
    public async Task Initialization_filters_buildings_and_opens_the_first_active_model()
    {
        _client.Properties.AddRange([
            new PropertySummary("site", null, "SITE", "Campus", null),
            Building("b2", "Warehouse"),
            Building("b1", "Headquarters"),
        ]);
        AddModel("b1", WexBimFixture.CubeA());
        AddModel("b2", WexBimFixture.TwoProxy());

        var viewModel = await CreateAsync();

        Assert.Equal(["Headquarters", "Warehouse"], viewModel.Buildings.Select(static b => b.Name));
        Assert.Equal("b1", viewModel.SelectedBuilding?.Id);
        Assert.Equal(BimViewerState.Ready, viewModel.State);
        Assert.NotNull(viewModel.Scene);
        Assert.Equal(12, viewModel.Scene.TriangleCount);
        Assert.Contains("12 triangles", viewModel.GeometryCaption, StringComparison.Ordinal);
        Assert.Equal("token-1", _client.LastBearerToken);
    }

    [Fact]
    public async Task Selecting_another_building_replaces_the_scene()
    {
        _client.Properties.AddRange([Building("a", "Alpha"), Building("b", "Beta")]);
        AddModel("a", WexBimFixture.CubeA());
        AddModel("b", WexBimFixture.TwoProxy());
        var viewModel = await CreateAsync();

        viewModel.SelectedBuilding = viewModel.Buildings.Single(static building => building.Id == "b");
        await viewModel.CurrentLoad;

        Assert.Equal(BimViewerState.Ready, viewModel.State);
        Assert.Equal(24, viewModel.Scene?.TriangleCount);
        Assert.Equal("b", viewModel.SelectedBuilding.Id);
    }

    [Fact]
    public async Task An_empty_property_scope_has_an_actionable_empty_state()
    {
        var viewModel = await CreateAsync();

        Assert.Equal(BimViewerState.NoBuildings, viewModel.State);
        Assert.True(viewModel.HasStatus);
        Assert.Contains("Create a building", viewModel.StatusMessage, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_building_without_a_model_is_distinct_from_missing_geometry()
    {
        _client.Properties.Add(Building("b1", "HQ"));

        var viewModel = await CreateAsync();

        Assert.Equal(BimViewerState.NoModel, viewModel.State);
        Assert.Contains("Import an IFC", viewModel.StatusMessage, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Missing_portable_geometry_explains_that_the_IFC_must_be_reimported()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        _client.BuildingModels["b1"] = Model("b1");

        var viewModel = await CreateAsync();

        Assert.Equal(BimViewerState.NoGeometry, viewModel.State);
        Assert.True(viewModel.CanRetry);
        Assert.Contains("Windows desktop client", viewModel.StatusMessage, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Invalid_geometry_never_reaches_the_ready_state()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", [1, 2, 3, 4]);

        var viewModel = await CreateAsync();

        Assert.Equal(BimViewerState.Error, viewModel.State);
        Assert.Null(viewModel.Scene);
        Assert.Contains("invalid wexBIM", viewModel.StatusMessage, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Import_tessellates_pairs_and_activates_before_showing_the_scene()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        var viewModel = await CreateAsync();
        var sourcePath = WriteTemporaryIfc();
        try
        {
            await viewModel.ImportFileAsync(sourcePath, "headquarters.ifc");
        }
        finally
        {
            File.Delete(sourcePath);
        }

        Assert.Equal(["ifc", "geometry", "metadata", "activate"], _client.BuildingModelOperations);
        Assert.Equal("headquarters.ifc", _client.UploadedFileName);
        Assert.NotNull(_client.UploadedIfc);
        Assert.Equal(_tessellator.Geometry, _client.UploadedGeometry);
        Assert.Equal(_tessellator.Elements, _client.UploadedMetadata);
        Assert.NotNull(_client.ActivatedVersion);
        Assert.Empty(_client.DeletedVersions);
        Assert.Equal(BimViewerState.Ready, viewModel.State);
        Assert.Equal(12, viewModel.Scene?.TriangleCount);
        Assert.Null(viewModel.ImportError);
        Assert.False(viewModel.IsImporting);
    }

    [Fact]
    public async Task Import_seeds_the_georeference_the_ifc_carries()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        _tessellator.Georeference = new BimGeoreference(49.1, 8.44, 10, 20, 90, 0.001);
        var viewModel = await CreateAsync();
        var sourcePath = WriteTemporaryIfc();
        try
        {
            await viewModel.ImportFileAsync(sourcePath, "headquarters.ifc");
        }
        finally
        {
            File.Delete(sourcePath);
        }

        Assert.Equal(
            ["ifc", "geometry", "metadata", "activate", "georeference"],
            _client.BuildingModelOperations);
        var georeference = _client.BuildingModels["b1"].Georeference;
        Assert.NotNull(georeference);
        Assert.Equal(49.1, georeference!.AnchorLatitude);
        Assert.Equal(90, georeference.RotationDegrees);
        Assert.Equal(georeference, viewModel.Model?.Georeference);
        Assert.Equal(BimViewerState.Ready, viewModel.State);
    }

    [Fact]
    public async Task Import_never_overwrites_an_existing_georeference()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        var manual = new ModelGeoreferenceSummary(50.0, 7.0, 0, 0, 0, 1);
        _client.BuildingModels["b1"] = Model("b1") with { Georeference = manual };
        _tessellator.Georeference = new BimGeoreference(49.1, 8.44, 10, 20, 90, 0.001);
        var viewModel = await CreateAsync();
        var sourcePath = WriteTemporaryIfc();
        try
        {
            await viewModel.ImportFileAsync(sourcePath, "headquarters.ifc");
        }
        finally
        {
            File.Delete(sourcePath);
        }

        Assert.DoesNotContain("georeference", _client.BuildingModelOperations);
        Assert.Equal(manual, _client.BuildingModels["b1"].Georeference);
        Assert.Equal(BimViewerState.Ready, viewModel.State);
    }

    [Fact]
    public async Task A_failed_georeference_seed_does_not_fail_the_import()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        _tessellator.Georeference = new BimGeoreference(49.1, 8.44, 10, 20, 90, 0.001);
        _client.GeoreferenceFailure = new HttpRequestException("connection reset");
        var viewModel = await CreateAsync();
        var sourcePath = WriteTemporaryIfc();
        try
        {
            await viewModel.ImportFileAsync(sourcePath, "headquarters.ifc");
        }
        finally
        {
            File.Delete(sourcePath);
        }

        Assert.Equal(BimViewerState.Ready, viewModel.State);
        Assert.Null(viewModel.ImportError);
        Assert.Empty(_client.DeletedVersions);
    }

    [Fact]
    public async Task Applying_a_first_map_anchor_pins_the_scene_centre()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        var viewModel = await CreateAsync();

        viewModel.GeoreferenceLatitudeInput = "49.1";
        viewModel.GeoreferenceLongitudeInput = "8.44";
        viewModel.GeoreferenceRotationInput = "90";
        await viewModel.ApplyGeoreferenceCommand.ExecuteAsync(null);

        var georeference = _client.BuildingModels["b1"].Georeference;
        Assert.NotNull(georeference);
        Assert.Equal(49.1, georeference!.AnchorLatitude);
        Assert.Equal(8.44, georeference.AnchorLongitude);
        Assert.Equal(90, georeference.RotationDegrees);
        var scene = viewModel.Scene!;
        Assert.Equal(scene.Bounds.Center.X, georeference.AnchorX, 3);
        Assert.Equal(scene.Bounds.Center.Y, georeference.AnchorY, 3);
        Assert.Equal(1.0 / scene.Meter, georeference.MetersPerUnit, 9);
        Assert.True(viewModel.HasGeoreference);
        Assert.Null(viewModel.OperationError);
    }

    [Fact]
    public async Task Editing_an_existing_anchor_keeps_its_model_frame_point()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        _client.BuildingModels["b1"] = _client.BuildingModels["b1"] with
        {
            Georeference = new ModelGeoreferenceSummary(50, 7, 12.5, -3.5, 15, 0.001),
        };
        var viewModel = await CreateAsync();

        Assert.Equal("50", viewModel.GeoreferenceLatitudeInput);
        viewModel.GeoreferenceLatitudeInput = "51.5";
        await viewModel.ApplyGeoreferenceCommand.ExecuteAsync(null);

        var georeference = _client.BuildingModels["b1"].Georeference;
        Assert.NotNull(georeference);
        Assert.Equal(51.5, georeference!.AnchorLatitude);
        Assert.Equal(12.5, georeference.AnchorX);
        Assert.Equal(-3.5, georeference.AnchorY);
        Assert.Equal(0.001, georeference.MetersPerUnit);
        Assert.Equal(15, georeference.RotationDegrees);
    }

    [Fact]
    public async Task Invalid_anchor_input_never_reaches_the_appliance()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        var viewModel = await CreateAsync();

        viewModel.GeoreferenceLatitudeInput = "not-a-number";
        viewModel.GeoreferenceLongitudeInput = "8.44";
        await viewModel.ApplyGeoreferenceCommand.ExecuteAsync(null);

        Assert.NotNull(viewModel.OperationError);
        Assert.DoesNotContain("georeference", _client.BuildingModelOperations);
        Assert.Null(_client.BuildingModels["b1"].Georeference);
    }

    [Fact]
    public async Task Clearing_the_anchor_removes_it_and_empties_the_inputs()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        _client.BuildingModels["b1"] = _client.BuildingModels["b1"] with
        {
            Georeference = new ModelGeoreferenceSummary(50, 7, 0, 0, 0, 1),
        };
        var viewModel = await CreateAsync();

        await viewModel.ClearGeoreferenceCommand.ExecuteAsync(null);

        Assert.Null(_client.BuildingModels["b1"].Georeference);
        Assert.False(viewModel.HasGeoreference);
        Assert.Equal("", viewModel.GeoreferenceLatitudeInput);
        Assert.Null(viewModel.OperationError);
    }

    [Fact]
    public async Task Failed_geometry_upload_deletes_the_inactive_ifc_version()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        _client.GeometryUploadFailure = new HttpRequestException("connection reset");
        var viewModel = await CreateAsync();
        var sourcePath = WriteTemporaryIfc();
        try
        {
            await viewModel.ImportFileAsync(sourcePath, "headquarters.ifc");
        }
        finally
        {
            File.Delete(sourcePath);
        }

        Assert.Equal(["ifc", "delete"], _client.BuildingModelOperations);
        Assert.Single(_client.DeletedVersions);
        Assert.Null(_client.ActivatedVersion);
        Assert.Equal(BimViewerState.NoModel, viewModel.State);
        Assert.Contains("connection failed", viewModel.ImportError, StringComparison.OrdinalIgnoreCase);
        Assert.False(viewModel.IsImporting);
    }

    [Fact]
    public async Task Changing_buildings_during_activation_does_not_show_or_delete_the_previous_model()
    {
        _client.Properties.AddRange([Building("b1", "Alpha"), Building("b2", "Beta")]);
        _client.ActivationGate = new TaskCompletionSource<bool>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var viewModel = await CreateAsync();
        var sourcePath = WriteTemporaryIfc();
        try
        {
            var import = viewModel.ImportFileAsync(sourcePath, "alpha.ifc");
            _ = await _client.ActivationStarted.Task.WaitAsync(
                TestContext.Current.CancellationToken);

            viewModel.SelectedBuilding =
                viewModel.Buildings.Single(static building => building.Id == "b2");
            await viewModel.CurrentLoad;

            _client.ActivationGate.SetResult(true);
            await import;
        }
        finally
        {
            File.Delete(sourcePath);
        }

        Assert.Equal("b2", viewModel.SelectedBuilding?.Id);
        Assert.Equal(BimViewerState.NoModel, viewModel.State);
        Assert.Null(viewModel.Scene);
        Assert.NotNull(_client.ActivatedVersion);
        Assert.Empty(_client.DeletedVersions);
        Assert.False(viewModel.IsImporting);
    }

    [Fact]
    public async Task Non_windows_import_explains_the_platform_requirement_without_uploading()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        _tessellator.IsSupported = false;
        var viewModel = await CreateAsync();

        await viewModel.ImportFileAsync("unused.ifc", "unused.ifc");

        Assert.False(viewModel.CanImport);
        Assert.Empty(_client.BuildingModelOperations);
        Assert.Contains("Windows", viewModel.ImportError, StringComparison.Ordinal);
        Assert.Contains("Windows", viewModel.StatusMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Camera_fit_orbit_pan_zoom_and_presets_remain_finite()
    {
        var camera = new BimCamera();
        var bounds = new BimBounds(new Vector3(-20, -10, 0), new Vector3(20, 10, 12));
        camera.Fit(bounds);
        var fittedDistance = camera.Distance;

        camera.Orbit(80, -30);
        camera.Pan(40, -15, 720);
        camera.Zoom(2);
        camera.SetPreset(BimViewPreset.Top);
        var snapshot = camera.Snapshot(16d / 9d);

        Assert.True(fittedDistance > bounds.Radius);
        Assert.True(camera.Distance > 0);
        Assert.True(float.IsFinite(snapshot.Eye.X));
        Assert.True(float.IsFinite(snapshot.Eye.Y));
        Assert.True(float.IsFinite(snapshot.Eye.Z));
        Assert.True(snapshot.Near > 0);
        Assert.True(snapshot.Far > snapshot.Near);
        Assert.NotEqual(Matrix4x4.Identity, snapshot.View);
        Assert.NotEqual(Matrix4x4.Identity, snapshot.Projection);
    }

    [Fact]
    public async Task Metadata_enables_named_categories_selection_and_visibility_controls()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        AddMetadata("b1");
        var viewModel = await CreateAsync();
        var product = viewModel.Scene!.Products.Values.Single();

        await viewModel.HandlePickAsync(new BimPickResult(
            BimPickKind.Product,
            product.Bounds.Center,
            Vector3.UnitZ,
            1,
            ProductLabel: product.Label));
        viewModel.ToggleCategoryCommand.Execute(viewModel.Categories.Single());

        Assert.True(viewModel.HasElementMetadata);
        Assert.Equal("Fixture wall", viewModel.SelectedProductCaption);
        Assert.Equal("IfcWall", viewModel.Categories.Single().Name);
        Assert.Contains(product.Label, viewModel.RenderOptions.HiddenProductLabels);

        viewModel.ShowAllCommand.Execute(null);
        viewModel.IsolateSelectedCommand.Execute(null);

        Assert.Empty(viewModel.RenderOptions.HiddenProductLabels);
        Assert.Equal(product.Label, viewModel.RenderOptions.IsolatedProductLabel);
    }

    [Fact]
    public async Task Device_placement_is_optimistic_and_persists_the_surface_point()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        AddMetadata("b1");
        _client.BimDevices.Add(Device("d1", "b1"));
        var viewModel = await CreateAsync();
        viewModel.SelectedDevice = viewModel.Devices.Single();

        viewModel.BeginPlaceDeviceCommand.Execute(null);
        await viewModel.HandlePickAsync(new BimPickResult(
            BimPickKind.Product,
            new Vector3(12.5f, -3f, 7.25f),
            Vector3.UnitZ,
            1,
            ProductLabel: viewModel.Scene!.Products.Keys.Single()));

        Assert.Equal(BimInteractionMode.Select, viewModel.InteractionMode);
        Assert.Equal(12.5, viewModel.SelectedDevice!.Device.X);
        Assert.Equal(-3, viewModel.SelectedDevice.Device.Y);
        Assert.Equal(7.25, viewModel.SelectedDevice.Device.Z);
        Assert.True(viewModel.SelectedDevice.IsPlaced);
        Assert.Single(viewModel.RenderOptions.Devices);
    }

    [Fact]
    public async Task Failed_device_placement_rolls_back_only_the_spatial_fields()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        AddMetadata("b1");
        _client.BimDevices.Add(Device("d1", "b1") with { Notes = "keep me" });
        var viewModel = await CreateAsync();
        viewModel.SelectedDevice = viewModel.Devices.Single();
        _client.BimOperationsFailure = new HttpRequestException("offline");

        viewModel.BeginPlaceDeviceCommand.Execute(null);
        await viewModel.HandlePickAsync(new BimPickResult(
            BimPickKind.Product,
            new Vector3(1, 2, 3),
            Vector3.UnitZ,
            1,
            ProductLabel: viewModel.Scene!.Products.Keys.Single()));

        Assert.False(viewModel.SelectedDevice!.IsPlaced);
        Assert.Equal("keep me", viewModel.SelectedDevice.Device.Notes);
        Assert.Contains("could not be saved", viewModel.OperationError, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Device_linking_uses_the_durable_IFC_GlobalId_and_can_be_cleared()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        AddMetadata("b1");
        _client.BimDevices.Add(Device("d1", "b1"));
        var viewModel = await CreateAsync();
        viewModel.SelectedDevice = viewModel.Devices.Single();
        var product = viewModel.Scene!.Products.Values.Single();

        viewModel.BeginLinkDeviceCommand.Execute(null);
        await viewModel.HandlePickAsync(new BimPickResult(
            BimPickKind.Product,
            product.Bounds.Center,
            Vector3.UnitZ,
            1,
            ProductLabel: product.Label));

        Assert.Equal(product.GlobalId, viewModel.SelectedDevice!.Device.IfcGlobalId);

        await viewModel.ClearDeviceLinkCommand.ExecuteAsync(null);

        Assert.Null(viewModel.SelectedDevice.Device.IfcGlobalId);
    }

    [Fact]
    public async Task Selecting_a_device_loads_metric_names_series_and_status_events()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        _client.BimDevices.Add(Device("d1", "b1"));
        _client.BimDeviceStatuses.Add(new BimDeviceStatus(
            "d1",
            "WARNING",
            18.4,
            DateTime.UtcNow,
            DateTime.UtcNow,
            DateTime.UtcNow));
        _client.MetricNames["d1"] = ["latency_ms"];
        _client.Metrics[("d1", "latency_ms")] =
        [
            new BimMetricPoint(DateTime.UtcNow.AddMinutes(-1), 20),
            new BimMetricPoint(DateTime.UtcNow, 18.4),
        ];
        _client.StatusEvents["d1"] =
        [
            new BimStatusEvent(DateTime.UtcNow, "WARNING", "icmp"),
        ];
        var viewModel = await CreateAsync();

        viewModel.SelectedDevice = viewModel.Devices.Single();
        await viewModel.CurrentTelemetryLoad;

        Assert.Equal("latency_ms", viewModel.SelectedMetricName);
        Assert.Equal(2, viewModel.MetricSeries?.Points.Count);
        Assert.Single(viewModel.StatusEvents);
        Assert.Equal(1, viewModel.WarningCount);
    }

    [Fact]
    public async Task Bcf_capture_round_trips_selection_camera_and_snapshot()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        AddMetadata("b1");
        var viewModel = await CreateAsync();
        viewModel.SelectedProduct = viewModel.Scene!.Products.Values.Single();
        viewModel.NewIssueTitle = "Inspect wall penetration";

        await viewModel.CreateIssueAsync([137, 80, 78, 71, 13, 10, 26, 10]);

        var topic = Assert.Single(_client.BcfTopics);
        var viewpoint = Assert.Single(topic.Viewpoints);
        Assert.Equal("Inspect wall penetration", topic.Title);
        Assert.Contains(viewModel.SelectedProduct.GlobalId!, viewpoint.Components.Selection);
        Assert.Equal("perspective", viewpoint.Camera.Kind);
        Assert.True(viewpoint.HasSnapshot);
        Assert.Single(viewModel.BcfTopics);
        Assert.Empty(viewModel.NewIssueTitle);
    }

    [Fact]
    public async Task Bcf_device_selection_uses_the_exported_device_GlobalId()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        _client.BimDevices.Add(Device("d1", "b1"));
        var viewModel = await CreateAsync();
        viewModel.SelectedDevice = viewModel.Devices.Single();
        viewModel.NewIssueTitle = "Inspect switch";

        await viewModel.CreateIssueAsync([137, 80, 78, 71, 13, 10, 26, 10]);

        var viewpoint = Assert.Single(Assert.Single(_client.BcfTopics).Viewpoints);
        Assert.Equal(
            [IfcGlobalId.Of("d1")],
            viewpoint.Components.Selection);
    }

    [Fact]
    public async Task Applying_a_Bcf_viewpoint_restores_camera_selection_and_visibility()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        AddMetadata("b1");
        const string globalId = "0ABCDEFGHIJKLMNOPQRSTU";
        _client.BcfTopics.Add(new BcfTopic(
            "topic-1",
            "b1",
            Guid.NewGuid().ToString(),
            "Saved view",
            "Issue",
            "OPEN",
            "HIGH",
            1,
            0,
            [],
            [
                new BcfViewpoint(
                    "view-1",
                    Guid.NewGuid().ToString(),
                    new BcfCamera(
                        "perspective",
                        [100d, 200d, 300d],
                        [-0.5d, -0.5d, -0.5d],
                        [0d, 0d, 1d],
                        55d,
                        null),
                    new BcfComponents(
                        [globalId],
                        new BcfVisibility(false, [globalId])),
                    [],
                    true,
                    true),
            ]));
        var viewModel = await CreateAsync();
        viewModel.SelectedBcfTopic = viewModel.BcfTopics.Single();

        await viewModel.ApplySelectedIssueCommand.ExecuteAsync(null);

        Assert.Equal(globalId, viewModel.SelectedProduct?.GlobalId);
        Assert.Equal(viewModel.SelectedProduct?.Label, viewModel.RenderOptions.IsolatedProductLabel);
        Assert.InRange(viewModel.Camera.FieldOfViewDegrees, 54.99f, 55.01f);
    }

    [Fact]
    public async Task Applying_a_Bcf_device_viewpoint_reselects_the_NodeScope_device()
    {
        _client.Properties.Add(Building("b1", "HQ"));
        AddModel("b1", WexBimFixture.CubeA());
        _client.BimDevices.Add(Device("d1", "b1"));
        _client.BcfTopics.Add(new BcfTopic(
            "topic-device",
            "b1",
            Guid.NewGuid().ToString(),
            "Switch view",
            "Issue",
            "OPEN",
            "NORMAL",
            1,
            0,
            [],
            [
                new BcfViewpoint(
                    "view-device",
                    Guid.NewGuid().ToString(),
                    new BcfCamera(
                        "perspective",
                        [100d, 200d, 300d],
                        [-0.5d, -0.5d, -0.5d],
                        [0d, 0d, 1d],
                        45d,
                        null),
                    new BcfComponents(
                        [IfcGlobalId.Of("d1")],
                        new BcfVisibility(true, [])),
                    [],
                    true,
                    false),
            ]));
        var viewModel = await CreateAsync();
        viewModel.SelectedBcfTopic = viewModel.BcfTopics.Single();

        await viewModel.ApplySelectedIssueCommand.ExecuteAsync(null);

        Assert.Equal("d1", viewModel.SelectedDevice?.Id);
        Assert.Null(viewModel.SelectedProduct);
    }

    private async Task<BimViewerViewModel> CreateAsync()
    {
        _viewModel = new BimViewerViewModel(
            new ApplianceSession(_client, "token-1"),
            NullLogger<BimViewerViewModel>.Instance,
            _tessellator);
        await _viewModel.Initialization;
        return _viewModel;
    }

    private void AddModel(string propertyId, byte[] geometry)
    {
        _client.BuildingModels[propertyId] = Model(propertyId);
        _client.BuildingGeometry[propertyId] = geometry;
    }

    private void AddMetadata(string propertyId)
    {
        var productLabel = WexBimReader.Read(
            _client.BuildingGeometry[propertyId],
            TestContext.Current.CancellationToken).Products.Keys.Single();
        _client.BuildingMetadata[propertyId] = new BuildingModelMetadataSummary(
            $"version-{propertyId}",
            1,
            [new BuildingModelElementMetadata(
                productLabel,
                "0ABCDEFGHIJKLMNOPQRSTU",
                "IfcWall",
                "Fixture wall")]);
    }

    private static BimDevice Device(string id, string propertyId) => new(
        id,
        "network-1",
        propertyId,
        null,
        null,
        "Core switch",
        "SWITCH",
        null,
        null,
        1,
        "Level 1",
        null,
        null,
        null,
        null,
        "10.0.0.1",
        null,
        null,
        1,
        DateTime.UtcNow,
        DateTime.UtcNow);

    private static PropertySummary Building(string id, string name) =>
        new(id, "site", "BUILDING", name, null);

    private static BuildingModelSummary Model(string propertyId) =>
        new($"model-{propertyId}", propertyId, $"Model {propertyId}", $"version-{propertyId}", null, 1);

    private static string WriteTemporaryIfc()
    {
        var path = Path.Combine(Path.GetTempPath(), $"nodescope-import-{Guid.NewGuid():N}.ifc");
        File.WriteAllText(path, "ISO-10303-21;\nEND-ISO-10303-21;\n");
        return path;
    }
}
