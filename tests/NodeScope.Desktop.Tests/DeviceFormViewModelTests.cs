using System.Text.Json;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.ViewModels;
using Xunit;

namespace NodeScope.Desktop.Tests;

/// <summary>
/// The shared device form in isolation: validation mirroring the server's create
/// rules, minimal-changeset building (cleared optionals ride as explicit nulls),
/// the indented property picker, and the never-overwrite name suggestion.
/// </summary>
public sealed class DeviceFormViewModelTests
{
    private static readonly IReadOnlyList<PropertyOption> Properties =
        PropertyOption.Flatten(
        [
            new PropertySummary("site-1", null, "SITE", "HQ Campus", null),
            new PropertySummary("bldg-1", "site-1", "BUILDING", "Main Building", null),
            new PropertySummary("floor-1", "bldg-1", "FLOOR", "Level 1", null),
        ]);

    private static BimDevice Original() => new(
        "d1", "n1", "bldg-1", null, "user-1", "Core Router", "ROUTER", 40.7, -74.0, 1, "Main Level",
        null, null, null, null, "10.0.0.1", "AA:BB:CC:DD:EE:FF", "old notes", 3,
        DateTime.UtcNow, DateTime.UtcNow);

    private static DeviceFormViewModel Create(
        BimDevice? original = null,
        Func<string, string, CancellationToken, Task<string>>? suggest = null) => new(
        original,
        Properties,
        submit: (_, _) => Task.FromResult(true),
        close: () => { },
        suggestName: suggest);

    [Fact]
    public void The_property_picker_indents_by_tree_depth()
    {
        Assert.Equal("HQ Campus (SITE)", Properties[0].Label);
        Assert.Equal("    Main Building (BUILDING)", Properties[1].Label);
        Assert.Equal("        Level 1 (FLOOR)", Properties[2].Label);
    }

    [Fact]
    public void Create_validation_mirrors_the_server_rules()
    {
        var form = Create();

        var empty = form.Validate();
        Assert.Contains(empty, error => error.Contains("Name", StringComparison.Ordinal));
        Assert.Contains(empty, error => error.Contains("property", StringComparison.Ordinal));

        form.Name = new string('x', 101);
        form.SelectedProperty = form.Properties[1];
        form.Floor = "999";
        form.IpAddress = "999.1.2.3";
        form.MacAddress = "not-a-mac";
        var invalid = form.Validate();
        Assert.Contains(invalid, error => error.Contains("100 characters", StringComparison.Ordinal));
        Assert.Contains(invalid, error => error.Contains("-10 to 200", StringComparison.Ordinal));
        Assert.Contains(invalid, error => error.Contains("IP address", StringComparison.Ordinal));
        Assert.Contains(invalid, error => error.Contains("MAC address", StringComparison.Ordinal));

        form.Name = "Switch 1";
        form.Floor = "2";
        form.IpAddress = "192.168.1.10";
        form.MacAddress = "AA:BB:CC:DD:EE:FF";
        Assert.Empty(form.Validate());
    }

    [Fact]
    public void An_ipv6_address_passes_like_the_server_rule()
    {
        var form = Create();
        form.Name = "x";
        form.SelectedProperty = form.Properties[0];
        form.IpAddress = "2001:db8::1";

        Assert.Empty(form.Validate());
    }

    [Fact]
    public void BuildCreate_carries_the_placement_and_nulls_empty_optionals()
    {
        var form = Create();
        form.Name = "  Switch 1  ";
        form.SelectedCategory = form.Categories.Single(category => category.Category == "SWITCH");
        form.SelectedProperty = form.Properties[1];
        form.PlacedLatitude = 40.71;
        form.PlacedLongitude = -74.01;
        form.FloorLabel = "   ";

        var create = form.BuildCreate("n1");

        Assert.Equal("Switch 1", create.Name);
        Assert.Equal("SWITCH", create.Category);
        Assert.Equal("n1", create.NetworkId);
        Assert.Equal("bldg-1", create.PropertyId);
        Assert.Equal(40.71, create.Latitude);
        Assert.Null(create.FloorLabel);
        Assert.Null(create.Floor);
    }

    [Fact]
    public void BuildChanges_diffs_minimally_and_clears_with_explicit_null()
    {
        var form = Create(Original());

        // Untouched form produces no changes.
        Assert.Empty(form.BuildChanges());

        form.Name = "Renamed";
        form.IpAddress = "";
        form.Floor = "";
        var changes = form.BuildChanges();

        Assert.Equal(3, changes.Count);
        var name = changes.Single(change => change.Field == "name");
        Assert.Equal("Renamed", name.NewValue.GetString());
        Assert.Equal("Core Router", name.OldValue.GetString());
        var ip = changes.Single(change => change.Field == "ipAddress");
        Assert.Equal(JsonValueKind.Null, ip.NewValue.ValueKind);
        var floor = changes.Single(change => change.Field == "floor");
        Assert.Equal(JsonValueKind.Null, floor.NewValue.ValueKind);
    }

    [Fact]
    public void A_relocation_rides_as_a_lat_lng_change_pair()
    {
        var form = Create(Original());
        form.PlacedLatitude = 41.0;
        form.PlacedLongitude = -73.5;

        var changes = form.BuildChanges();

        Assert.Equal(2, changes.Count);
        Assert.Equal(41.0, changes.Single(change => change.Field == "latitude").NewValue.GetDouble());
        Assert.Equal(-73.5, changes.Single(change => change.Field == "longitude").NewValue.GetDouble());
    }

    [Fact]
    public async Task The_name_suggestion_fills_but_never_overwrites_a_typed_name()
    {
        var requests = new List<(string PropertyId, string Category)>();
        var form = Create(suggest: (propertyId, category, _) =>
        {
            requests.Add((propertyId, category));
            return Task.FromResult($"{category} 2");
        });

        form.SelectedProperty = form.Properties[1];
        await Task.Delay(50, TestContext.Current.CancellationToken);
        Assert.Equal("ROUTER 2", form.Name);
        Assert.Equal(("bldg-1", "ROUTER"), Assert.Single(requests));

        // A suggestion-set name still counts as untyped: a category change refreshes it.
        form.SelectedCategory = form.Categories.Single(category => category.Category == "SWITCH");
        await Task.Delay(50, TestContext.Current.CancellationToken);
        Assert.Equal("SWITCH 2", form.Name);

        // A user-typed name is never overwritten.
        form.Name = "My Device";
        form.SelectedCategory = form.Categories.Single(category => category.Category == "UPS");
        await Task.Delay(50, TestContext.Current.CancellationToken);
        Assert.Equal("My Device", form.Name);
    }
}
