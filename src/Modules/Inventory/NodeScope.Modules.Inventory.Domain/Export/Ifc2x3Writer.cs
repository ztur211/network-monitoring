using System.Globalization;
using System.Text;
using NodeScope.Contracts;

namespace NodeScope.Modules.Inventory.Domain.Export;

/// <summary>A device with model-local coordinates, the only thing the export writes out.</summary>
public sealed record ExportDevice(string Id, double X, double Y, double Z);

/// <summary>
/// Writes a building and its placed devices as an IFC2x3 STEP file. Pure - no I/O - so the
/// whole format is testable directly.
/// </summary>
public static class Ifc2x3Writer
{
    /// <summary>
    /// IFC coordinates are metres. Clamping keeps a garbage input from formatting in exponential
    /// notation, which is not a valid STEP REAL; real coordinates are far below the bound.
    /// </summary>
    private const double MaxCoordinate = 1e15;

    public static string BuildNetworkIfc(
        string buildingId,
        string buildingName,
        string storeyName,
        IReadOnlyList<ExportDevice> devices,
        DateTime timestamp)
    {
        ArgumentNullException.ThrowIfNull(devices);
        ArgumentNullException.ThrowIfNull(buildingName);
        var builder = new StepBuilder();
        string Guid(string suffix = "") =>
            $"'{IfcGlobalId.Of(suffix.Length == 0 ? buildingId : $"{buildingId}:{suffix}")}'";

        var person = builder.Add("IFCPERSON($,$,'NodeScope',$,$,$,$,$)");
        var organization = builder.Add("IFCORGANIZATION($,'NodeScope',$,$,$)");
        var personAndOrganization = builder.Add($"IFCPERSONANDORGANIZATION({person},{organization},$)");
        var application = builder.Add($"IFCAPPLICATION({organization},'1.0','NodeScope','NodeScope')");
        var seconds = (long)(timestamp.ToUniversalTime() - DateTime.UnixEpoch).TotalSeconds;
        var owner = builder.Add(
            $"IFCOWNERHISTORY({personAndOrganization},{application},$,.ADDED.,$,{personAndOrganization},{application},{seconds.ToString(CultureInfo.InvariantCulture)})");

        var metre = builder.Add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
        var units = builder.Add($"IFCUNITASSIGNMENT(({metre}))");
        var origin = builder.Add("IFCCARTESIANPOINT((0.,0.,0.))");
        var worldAxis = builder.Add($"IFCAXIS2PLACEMENT3D({origin},$,$)");
        var context = builder.Add($"IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,{worldAxis},$)");
        var project = builder.Add(
            $"IFCPROJECT({Guid()},{owner},{Text("NodeScope Network - " + buildingName)},$,$,$,$,({context}),{units})");

        string Place(string? relativeTo, double x = 0, double y = 0, double z = 0)
        {
            var point = builder.Add($"IFCCARTESIANPOINT(({Number(x)},{Number(y)},{Number(z)}))");
            var axis = builder.Add($"IFCAXIS2PLACEMENT3D({point},$,$)");
            return builder.Add($"IFCLOCALPLACEMENT({relativeTo ?? "$"},{axis})");
        }

        var sitePlacement = Place(null);
        var site = builder.Add(
            $"IFCSITE({Guid("site")},{owner},'Site',$,$,{sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)");
        var buildingPlacement = Place(sitePlacement);
        var building = builder.Add(
            $"IFCBUILDING({Guid("bldg")},{owner},{Text(buildingName)},$,$,{buildingPlacement},$,$,.ELEMENT.,$,$,$)");
        var storeyPlacement = Place(buildingPlacement);
        var storey = builder.Add(
            $"IFCBUILDINGSTOREY({Guid("storey")},{owner},{Text(storeyName)},$,$,{storeyPlacement},$,$,.ELEMENT.,0.)");
        builder.Add($"IFCRELAGGREGATES({Guid("a0")},{owner},$,$,{project},({site}))");
        builder.Add($"IFCRELAGGREGATES({Guid("a1")},{owner},$,$,{site},({building}))");
        builder.Add($"IFCRELAGGREGATES({Guid("a2")},{owner},$,$,{building},({storey}))");

        // One shared 0.2 m box; each proxy's local placement is what moves it.
        var origin2d = builder.Add("IFCCARTESIANPOINT((0.,0.))");
        var position2d = builder.Add($"IFCAXIS2PLACEMENT2D({origin2d},$)");
        var profile = builder.Add($"IFCRECTANGLEPROFILEDEF(.AREA.,$,{position2d},0.2,0.2)");
        var up = builder.Add("IFCDIRECTION((0.,0.,1.))");
        var solid = builder.Add($"IFCEXTRUDEDAREASOLID({profile},{worldAxis},{up},0.2)");
        var shape = builder.Add($"IFCSHAPEREPRESENTATION({context},'Body','SweptSolid',({solid}))");
        var productDefinition = builder.Add($"IFCPRODUCTDEFINITIONSHAPE($,$,({shape}))");

        var proxies = new List<string>(devices.Count);
        foreach (var device in devices)
        {
            var placement = Place(storeyPlacement, device.X, device.Y, device.Z);
            // The proxy carries only its native IFC GlobalId. The device association lives in
            // NodeScope's database, so no network data is ever written into the model.
            proxies.Add(builder.Add(
                $"IFCBUILDINGELEMENTPROXY('{IfcGlobalId.Of(device.Id)}',{owner},{Text("Network Device")},$,$,{placement},{productDefinition},$,$)"));
        }

        if (proxies.Count > 0)
        {
            builder.Add(
                $"IFCRELCONTAINEDINSPATIALSTRUCTURE({Guid("contain")},{owner},$,$,({string.Join(",", proxies)}),{storey})");
        }

        var stamp = timestamp.ToUniversalTime().ToString("yyyy-MM-dd'T'HH':'mm':'ss'.'fff'Z'", CultureInfo.InvariantCulture);
        var header = string.Join(
            '\n',
            "ISO-10303-21;",
            "HEADER;",
            "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
            $"FILE_NAME('{Escape(buildingName)}-network.ifc','{stamp}',('NodeScope'),('NodeScope'),'NodeScope','NodeScope','');",
            "FILE_SCHEMA(('IFC2X3'));",
            "ENDSEC;",
            "DATA;");
        return $"{header}\n{string.Join('\n', builder.Lines)}\nENDSEC;\nEND-ISO-10303-21;\n";
    }

    /// <summary>STEP string escaping: backslashes, doubled apostrophes, control characters neutralised.</summary>
    private static string Escape(string value)
    {
        var escaped = new StringBuilder(value.Length);
        foreach (var character in value)
        {
            escaped.Append(character switch
            {
                '\\' => "\\\\",
                '\'' => "''",
                <= '\u001F' => " ",
                _ => character.ToString(),
            });
        }

        return escaped.ToString();
    }

    private static string Text(string? value) => value is null ? "$" : $"'{Escape(value)}'";

    private static string Number(double value)
    {
        var clamped = double.IsFinite(value) ? Math.Clamp(value, -MaxCoordinate, MaxCoordinate) : 0;
        return clamped.ToString("F6", CultureInfo.InvariantCulture);
    }

    /// <summary>Numbers the STEP entity lines, which reference each other by <c>#n</c>.</summary>
    private sealed class StepBuilder
    {
        private int _id;

        public List<string> Lines { get; } = [];

        public string Add(string body)
        {
            var reference = $"#{++_id}";
            Lines.Add($"{reference}= {body};");
            return reference;
        }
    }
}
