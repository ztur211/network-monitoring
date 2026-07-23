using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Domain.Bcf;

/// <summary>
/// Reads and writes BCF 2.1 <c>.bcfzip</c> archives. Pure: bytes in, bytes out, so the whole
/// format is testable without storage or a database.
/// </summary>
public static partial class BcfArchive
{
    /// <summary>
    /// The upload cap is 50 MB compressed, and DEFLATE reaches roughly 1000:1 on repetitive
    /// XML - so a conforming archive can still inflate to gigabytes. The decompressed total is
    /// capped as well, and the declared sizes are checked before anything is materialized.
    /// </summary>
    public const long DefaultMaxDecompressedBytes = 200 * 1024 * 1024;

    private static readonly byte[] PngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

    /// <summary>True when the bytes start with the 8-byte PNG signature (an empty buffer is false).</summary>
    public static bool IsPng(ReadOnlySpan<byte> content) => content.StartsWith(PngMagic);

    /// <summary>Thrown when an archive decompresses - or declares it will - beyond the cap.</summary>
    public static ApiException TooLarge() => new("BCF_001", "BCF_FILE_TOO_LARGE", 413);

    /// <summary>Thrown when the archive is not a readable BCF 2.1 file.</summary>
    public static ApiException Malformed() => new("BCF_003", "MALFORMED_BCF_ZIP", 422);

    public static IReadOnlyList<BcfTopicData> Read(ReadOnlyMemory<byte> archive, long maxDecompressedBytes)
    {
        using var buffer = new MemoryStream(archive.ToArray(), writable: false);
        using var zip = new ZipArchive(buffer, ZipArchiveMode.Read);

        // Pre-flight on the declared sizes: an honestly-declared bomb is rejected before a
        // single entry is decoded, because checking afterwards would already have OOM'd.
        long declared = 0;
        foreach (var entry in zip.Entries)
        {
            declared += entry.Length;
            if (entry.Length > maxDecompressedBytes || declared > maxDecompressedBytes)
            {
                throw TooLarge();
            }
        }

        var budget = new DecodeBudget(maxDecompressedBytes);
        var topics = new List<BcfTopicData>();
        foreach (var markupEntry in zip.Entries.Where(entry => MarkupPath().IsMatch(entry.FullName)))
        {
            var guid = markupEntry.FullName[..markupEntry.FullName.IndexOf('/', StringComparison.Ordinal)];
            topics.Add(ReadTopic(zip, guid, markupEntry, budget));
        }

        return topics;
    }

    public static byte[] Write(IReadOnlyList<BcfTopicData> topics)
    {
        ArgumentNullException.ThrowIfNull(topics);
        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            WriteXml(
                zip,
                "bcf.version",
                new XElement("Version", new XAttribute("VersionId", "2.1"), new XElement("DetailedVersion", "2.1")));

            foreach (var topic in topics)
            {
                WriteXml(zip, $"{topic.Guid}/markup.bcf", BuildMarkup(topic));
                if (topic.Viewpoints.Count == 0)
                {
                    continue;
                }

                var viewpoint = topic.Viewpoints[0];
                WriteXml(zip, $"{topic.Guid}/viewpoint.bcfv", BuildVisualizationInfo(viewpoint));
                if (viewpoint.SnapshotPng is { } snapshot)
                {
                    var entry = zip.CreateEntry($"{topic.Guid}/snapshot.png");
                    using var stream = entry.Open();
                    stream.Write(snapshot.Span);
                }
            }
        }

        return buffer.ToArray();
    }

    private static BcfTopicData ReadTopic(ZipArchive zip, string guid, ZipArchiveEntry markupEntry, DecodeBudget budget)
    {
        var markup = ParseXml(budget.ReadText(markupEntry)).Element("Topic")
            ?? throw Malformed();

        var viewpoints = new List<BcfViewpointData>();
        if (zip.GetEntry($"{guid}/viewpoint.bcfv") is { } viewpointEntry)
        {
            var info = ParseXml(budget.ReadText(viewpointEntry));
            var snapshot = zip.GetEntry($"{guid}/snapshot.png") is { } snapshotEntry
                ? budget.ReadBytes(snapshotEntry)
                : (ReadOnlyMemory<byte>?)null;
            viewpoints.Add(ReadViewpoint(guid, info, snapshot));
        }

        return new BcfTopicData(
            guid,
            Value(markup.Element("Title")) ?? throw Malformed(),
            Attribute(markup, "TopicType"),
            Attribute(markup, "TopicStatus"),
            Value(markup.Element("Priority")),
            [.. markup.Elements("Labels").Select(label => label.Value)],
            Value(markup.Element("CreationAuthor")) ?? throw Malformed(),
            ParseDate(Value(markup.Element("CreationDate"))) ?? throw Malformed(),
            Attribute(markup, "AssignedTo") ?? Value(markup.Element("AssignedTo")),
            Value(markup.Element("Description")),
            [.. markup.Parent!.Elements("Comment").Select(ReadComment)],
            viewpoints);
    }

    private static BcfViewpointData ReadViewpoint(string topicGuid, XElement info, ReadOnlyMemory<byte>? snapshot)
    {
        var perspective = info.Element("PerspectiveCamera");
        var camera = perspective ?? info.Element("OrthogonalCamera") ?? throw Malformed();
        var components = info.Element("Components");
        var visibility = components?.Element("Visibility");

        return new BcfViewpointData(
            info.Attribute("Guid")?.Value ?? $"{topicGuid}-vp",
            IsPrimary: true,
            new BcfCamera(
                perspective is not null ? "perspective" : "orthographic",
                ReadVector(camera.Element("CameraViewPoint")),
                ReadVector(camera.Element("CameraDirection")),
                ReadVector(camera.Element("CameraUpVector")),
                ParseNumber(Value(camera.Element("FieldOfView"))),
                ParseNumber(Value(camera.Element("ViewToWorldScale")))),
            new BcfComponents(
                [.. IfcGuids(components?.Element("Selection"))],
                new BcfVisibility(
                    visibility?.Attribute("DefaultVisibility")?.Value != "false",
                    [.. IfcGuids(visibility?.Element("Exceptions"))])),
            snapshot);
    }

    private static BcfCommentData ReadComment(XElement comment) => new(
        comment.Attribute("Guid")?.Value ?? "",
        Value(comment.Element("Comment")) ?? "",
        Value(comment.Element("Author")) ?? "",
        ParseDate(Value(comment.Element("Date"))) ?? DateTime.UnixEpoch,
        comment.Element("Viewpoint")?.Attribute("Guid")?.Value);

    private static XElement BuildMarkup(BcfTopicData topic) =>
        new(
            "Markup",
            new XElement(
                "Topic",
                new XAttribute("Guid", topic.Guid),
                Optional("TopicType", topic.TopicType, asAttribute: true),
                Optional("TopicStatus", topic.TopicStatus, asAttribute: true),
                new XElement("Title", topic.Title),
                Optional("Priority", topic.Priority),
                new XElement("CreationDate", Iso(topic.CreationDate)),
                new XElement("CreationAuthor", topic.CreationAuthor),
                Optional("AssignedTo", topic.AssignedTo),
                Optional("Description", topic.Description),
                topic.Labels.Select(label => new XElement("Labels", label))),
            topic.Comments.Select(comment => new XElement(
                "Comment",
                new XAttribute("Guid", comment.Guid),
                new XElement("Date", Iso(comment.Date)),
                new XElement("Author", comment.Author),
                new XElement("Comment", comment.Comment),
                comment.ViewpointGuid is null
                    ? null
                    : new XElement("Viewpoint", new XAttribute("Guid", comment.ViewpointGuid)))));

    private static XElement BuildVisualizationInfo(BcfViewpointData viewpoint)
    {
        var camera = new XElement(
            viewpoint.Camera.Kind == "perspective" ? "PerspectiveCamera" : "OrthogonalCamera",
            WriteVector("CameraViewPoint", viewpoint.Camera.Position),
            WriteVector("CameraDirection", viewpoint.Camera.Direction),
            WriteVector("CameraUpVector", viewpoint.Camera.Up));
        if (viewpoint.Camera.FieldOfView is { } fieldOfView)
        {
            camera.Add(new XElement("FieldOfView", Number(fieldOfView)));
        }

        if (viewpoint.Camera.ViewToWorldScale is { } scale)
        {
            camera.Add(new XElement("ViewToWorldScale", Number(scale)));
        }

        return new XElement(
            "VisualizationInfo",
            new XAttribute("Guid", viewpoint.Guid),
            new XElement(
                "Components",
                new XElement(
                    "Selection",
                    viewpoint.Components.Selection.Select(WriteComponent)),
                new XElement(
                    "Visibility",
                    new XAttribute(
                        "DefaultVisibility",
                        viewpoint.Components.Visibility.DefaultVisibility ? "true" : "false"),
                    new XElement(
                        "Exceptions",
                        viewpoint.Components.Visibility.Exceptions.Select(WriteComponent)))),
            camera);
    }

    private static XElement WriteComponent(string ifcGuid) =>
        new("Component", new XAttribute("IfcGuid", ifcGuid));

    private static XElement WriteVector(string name, IReadOnlyList<double> vector) =>
        new(
            name,
            new XElement("X", Number(vector.Count > 0 ? vector[0] : 0)),
            new XElement("Y", Number(vector.Count > 1 ? vector[1] : 0)),
            new XElement("Z", Number(vector.Count > 2 ? vector[2] : 0)));

    private static IReadOnlyList<double> ReadVector(XElement? vector) =>
    [
        ParseNumber(Value(vector?.Element("X"))) ?? 0,
        ParseNumber(Value(vector?.Element("Y"))) ?? 0,
        ParseNumber(Value(vector?.Element("Z"))) ?? 0,
    ];

    private static IEnumerable<string> IfcGuids(XElement? container) =>
        container?.Elements("Component").Select(component => component.Attribute("IfcGuid")?.Value ?? "")
        ?? [];

    private static void WriteXml(ZipArchive zip, string path, XElement root)
    {
        var entry = zip.CreateEntry(path);
        using var stream = entry.Open();
        // No byte-order mark: BCF files are UTF-8 by definition and several BCF readers
        // (including a naive XmlReader over the decoded text) reject a leading BOM.
        using var writer = XmlWriter.Create(
            stream,
            new XmlWriterSettings { Encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), Indent = true });
        new XDocument(root).Save(writer);
    }

    /// <summary>Parses with DTD processing prohibited, so external entities can never resolve.</summary>
    private static XElement ParseXml(string content)
    {
        try
        {
            using var reader = XmlReader.Create(
                new StringReader(content),
                new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
            return XDocument.Load(reader).Root ?? throw Malformed();
        }
        catch (XmlException)
        {
            throw Malformed();
        }
    }

    private static XObject? Optional(string name, string? value, bool asAttribute = false) =>
        value is null ? null : asAttribute ? new XAttribute(name, value) : new XElement(name, value);

    private static string? Value(XElement? element) =>
        element is null || element.Value.Length == 0 ? null : element.Value;

    private static string? Attribute(XElement element, string name) => element.Attribute(name)?.Value;

    private static double? ParseNumber(string? value) =>
        value is not null
        && double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number)
            ? number
            : null;

    private static DateTime? ParseDate(string? value) =>
        value is not null
        && DateTime.TryParse(
            value, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var date)
            ? date
            : null;

    private static string Number(double value) => value.ToString("R", CultureInfo.InvariantCulture);

    private static string Iso(DateTime value) => IsoTimestamp.Of(value);

    [GeneratedRegex(@"^[^/]+/markup\.bcf$")]
    private static partial Regex MarkupPath();

    /// <summary>
    /// Backstop for an entry whose header understates its size: counts what is actually
    /// decoded and stops once the cap is passed.
    /// </summary>
    private sealed class DecodeBudget
    {
        private readonly long _cap;
        private long _decoded;

        public DecodeBudget(long cap)
        {
            _cap = cap;
        }

        /// <summary>Decodes as UTF-8, tolerating the byte-order mark some writers emit.</summary>
        public string ReadText(ZipArchiveEntry entry) =>
            Encoding.UTF8.GetString(ReadBytes(entry).Span).TrimStart('\uFEFF');

        public ReadOnlyMemory<byte> ReadBytes(ZipArchiveEntry entry)
        {
            using var stream = entry.Open();
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            _decoded += buffer.Length;
            return _decoded > _cap ? throw TooLarge() : buffer.ToArray();
        }
    }
}
