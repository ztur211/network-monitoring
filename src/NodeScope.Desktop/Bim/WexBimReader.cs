using System.Buffers.Binary;
using System.Numerics;

namespace NodeScope.Desktop.Bim;

/// <summary>
/// Strict managed decoder for xBIM's little-endian wexBIM versions 1-4.
/// Parsing has no native dependency, so an artifact tessellated on Windows can
/// be viewed unchanged on every desktop platform.
/// </summary>
internal static class WexBimReader
{
    internal const int Magic = 94_132_117;

    private const int MaxHeaderCount = 100_000_000;
    private const int MaxTriangleCornersPerGeometry = 15_000_000;

    private static readonly Vector4 DefaultStyle = Vector4.One;
    private static readonly Vector4 SpaceStyle = new(0f, 1f, 1f, 100f / 255f);

    public static BimScene Read(ReadOnlyMemory<byte> content, CancellationToken cancellationToken = default)
    {
        if (content.IsEmpty)
        {
            throw Invalid("the file is empty");
        }

        var reader = new WexReader(content.Span);
        if (reader.ReadInt32("magic number") != Magic)
        {
            throw Invalid("the magic number does not identify a wexBIM file");
        }

        var version = reader.ReadByte("format version");
        if (version is < 1 or > 4)
        {
            throw Invalid($"format version {version} is not supported");
        }

        var header = new Header(
            Shapes: reader.ReadCount("shape count", MaxHeaderCount),
            Vertices: reader.ReadCount("vertex count", MaxHeaderCount),
            Triangles: reader.ReadCount("triangle count", MaxHeaderCount),
            Matrices: reader.ReadCount("matrix count", MaxHeaderCount),
            Products: reader.ReadCount("product count", MaxHeaderCount),
            Styles: reader.ReadCount("style count", MaxHeaderCount));

        var meter = reader.ReadSingle("model unit scale");
        if (!float.IsFinite(meter) || meter <= 0)
        {
            throw Invalid("the model unit scale must be finite and positive");
        }

        var wcs = version > 3
            ? new Vector3(
                CheckedFloat(reader.ReadDouble("WCS x"), "WCS x"),
                CheckedFloat(reader.ReadDouble("WCS y"), "WCS y"),
                CheckedFloat(reader.ReadDouble("WCS z"), "WCS z"))
            : Vector3.Zero;

        var regionCount = reader.ReadCount("region count", short.MaxValue, useInt16: true);
        var regionBounds = ReadRegions(ref reader, regionCount, cancellationToken);
        var styles = ReadStyles(ref reader, header.Styles, cancellationToken);
        var products = ReadProducts(ref reader, header.Products, cancellationToken);

        var geometries = new List<BimGeometry>();
        var counters = new ParseCounters();
        if (version >= 3)
        {
            for (var region = 0; region < regionCount; region++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var geometryCount = reader.ReadCount("region geometry count", MaxHeaderCount);
                for (var geometry = 0; geometry < geometryCount; geometry++)
                {
                    ReadGeometryRecord(
                        ref reader,
                        version,
                        styles,
                        products,
                        geometries,
                        counters,
                        hasLengthPrefix: true,
                        cancellationToken);
                }
            }
        }
        else
        {
            for (var shape = 0; shape < header.Shapes; shape++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                ReadGeometryRecord(
                    ref reader,
                    version,
                    styles,
                    products,
                    geometries,
                    counters,
                    hasLengthPrefix: false,
                    cancellationToken);
            }
        }

        if (!reader.IsAtEnd)
        {
            throw Invalid($"{reader.Remaining} trailing bytes remain after the declared model");
        }

        ValidateHeader(header, counters);

        var bounds = BimBounds.Empty;
        foreach (var geometry in geometries)
        {
            foreach (var instance in geometry.Instances)
            {
                if (instance.IsVisible)
                {
                    bounds = bounds.Include(geometry.Bounds.Transform(instance.Transform));
                }
            }
        }

        if (bounds.IsEmpty)
        {
            bounds = regionBounds;
        }

        return new BimScene(
            version,
            meter,
            wcs,
            bounds,
            geometries,
            products,
            counters.Shapes,
            counters.Triangles,
            content.Length);
    }

    private static BimBounds ReadRegions(
        ref WexReader reader,
        int count,
        CancellationToken cancellationToken)
    {
        var bounds = BimBounds.Empty;
        for (var index = 0; index < count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            _ = reader.ReadInt32("region population");
            _ = reader.ReadVector3("region center");
            var min = reader.ReadVector3("region bounds minimum");
            var size = reader.ReadVector3("region bounds size");
            if (size.X < 0 || size.Y < 0 || size.Z < 0)
            {
                throw Invalid("a region has a negative bounds size");
            }

            bounds = bounds.Include(new BimBounds(min, min + size));
        }

        return bounds;
    }

    private static Dictionary<int, Vector4> ReadStyles(
        ref WexReader reader,
        int count,
        CancellationToken cancellationToken)
    {
        var styles = new Dictionary<int, Vector4>();
        for (var index = 0; index < count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var id = reader.ReadInt32("style id");
            var color = new Vector4(
                ReadColor(ref reader, "style red"),
                ReadColor(ref reader, "style green"),
                ReadColor(ref reader, "style blue"),
                ReadColor(ref reader, "style alpha"));
            styles[id] = color;
        }

        return styles;
    }

    private static Dictionary<int, BimProduct> ReadProducts(
        ref WexReader reader,
        int count,
        CancellationToken cancellationToken)
    {
        var products = new Dictionary<int, BimProduct>();
        for (var index = 0; index < count; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var label = reader.ReadInt32("product label");
            var type = reader.ReadInt16("product type");
            var min = reader.ReadVector3("product bounds minimum");
            var size = reader.ReadVector3("product bounds size");
            if (size.X < 0 || size.Y < 0 || size.Z < 0)
            {
                throw Invalid($"product {label} has a negative bounds size");
            }

            if (!products.TryAdd(label, new BimProduct(label, type, new BimBounds(min, min + size))))
            {
                throw Invalid($"product label {label} is duplicated");
            }
        }

        return products;
    }

    private static void ReadGeometryRecord(
        ref WexReader reader,
        byte version,
        IReadOnlyDictionary<int, Vector4> styles,
        IReadOnlyDictionary<int, BimProduct> products,
        List<BimGeometry> geometries,
        ParseCounters counters,
        bool hasLengthPrefix,
        CancellationToken cancellationToken)
    {
        var instances = ReadInstances(
            ref reader,
            version,
            styles,
            products,
            counters,
            cancellationToken);

        TriangulatedGeometry triangulated;
        if (hasLengthPrefix)
        {
            var length = reader.ReadCount("geometry byte length", reader.Remaining);
            if (length == 0)
            {
                throw Invalid("a geometry record has no triangle payload");
            }

            var payload = reader.ReadBytes(length, "geometry payload");
            var geometryReader = new WexReader(payload);
            triangulated = ReadTriangulatedGeometry(ref geometryReader, cancellationToken);
            if (!geometryReader.IsAtEnd)
            {
                throw Invalid(
                    $"{geometryReader.Remaining} bytes remain inside a geometry payload");
            }
        }
        else
        {
            triangulated = ReadTriangulatedGeometry(ref reader, cancellationToken);
        }

        counters.Shapes = checked(counters.Shapes + 1);
        counters.Vertices = checked(counters.Vertices + triangulated.SourceVertexCount);
        counters.Triangles = checked(
            counters.Triangles + checked(triangulated.TriangleCount * instances.Count));
        geometries.Add(new BimGeometry(
            triangulated.Vertices,
            triangulated.TriangleCount,
            triangulated.Bounds,
            instances));
    }

    private static List<BimInstance> ReadInstances(
        ref WexReader reader,
        byte version,
        IReadOnlyDictionary<int, Vector4> styles,
        IReadOnlyDictionary<int, BimProduct> products,
        ParseCounters counters,
        CancellationToken cancellationToken)
    {
        var repetition = reader.ReadCount("shape repetition", MaxHeaderCount);
        if (repetition == 0)
        {
            throw Invalid("a shape has no instances");
        }

        var instances = new List<BimInstance>();
        for (var index = 0; index < repetition; index++)
        {
            if ((index & 4095) == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
            }

            var productLabel = reader.ReadInt32("shape product label");
            var instanceType = reader.ReadInt16("shape instance type");
            var instanceLabel = reader.ReadInt32("shape instance label");
            var styleId = reader.ReadInt32("shape style id");
            var transform = Matrix4x4.Identity;
            if (repetition > 1)
            {
                transform = ReadMatrix(ref reader, version);
                counters.Matrices = checked(counters.Matrices + 1);
            }

            var productType = products.TryGetValue(productLabel, out var product)
                ? product.Type
                : instanceType;
            var color = productType is 454 or 498 or 1217
                ? SpaceStyle
                : styles.GetValueOrDefault(styleId, DefaultStyle);

            instances.Add(new BimInstance(
                productLabel,
                productType,
                instanceLabel,
                transform,
                color));
        }

        return instances;
    }

    private static Matrix4x4 ReadMatrix(ref WexReader reader, byte version)
    {
        Span<float> values = stackalloc float[16];
        for (var index = 0; index < values.Length; index++)
        {
            values[index] = version == 1
                ? reader.ReadSingle("instance transform")
                : CheckedFloat(reader.ReadDouble("instance transform"), "instance transform");
        }

        // wexBIM stores the four OpenGL columns consecutively. System.Numerics
        // applies row vectors, so assigning the values directly produces the
        // same x*m0 + y*m4 + z*m8 + m12 point transform.
        return new Matrix4x4(
            values[0], values[1], values[2], values[3],
            values[4], values[5], values[6], values[7],
            values[8], values[9], values[10], values[11],
            values[12], values[13], values[14], values[15]);
    }

    private static TriangulatedGeometry ReadTriangulatedGeometry(
        ref WexReader reader,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var shapeVersion = reader.ReadByte("triangulated shape version");
        if (shapeVersion is < 1 or > 4)
        {
            throw Invalid($"triangulated shape version {shapeVersion} is not supported");
        }

        var vertexCount = reader.ReadCount("geometry vertex count", MaxHeaderCount);
        var triangleCount = reader.ReadCount("geometry triangle count", MaxHeaderCount);
        var cornerCount = checked(triangleCount * 3);
        if (cornerCount > MaxTriangleCornersPerGeometry)
        {
            throw Invalid(
                $"one geometry declares {cornerCount:N0} triangle corners, above the safe limit");
        }

        if (checked(vertexCount * 12L) > reader.Remaining)
        {
            throw Invalid("the declared geometry vertices exceed the payload");
        }

        var positions = new Vector3[vertexCount];
        var bounds = BimBounds.Empty;
        for (var index = 0; index < positions.Length; index++)
        {
            if ((index & 4095) == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
            }

            positions[index] = reader.ReadVector3("geometry vertex");
            bounds = bounds.Include(positions[index]);
        }

        var faceCount = reader.ReadCount("geometry face count", MaxHeaderCount);
        if ((vertexCount == 0) != (triangleCount == 0))
        {
            throw Invalid("empty geometry must have both zero vertices and zero triangles");
        }

        if (triangleCount == 0)
        {
            if (faceCount != 0)
            {
                throw Invalid("empty geometry cannot declare faces");
            }

            return new TriangulatedGeometry([], 0, vertexCount, bounds);
        }

        var vertices = new float[checked(cornerCount * BimGeometry.FloatsPerVertex)];
        var writtenCorners = 0;
        for (var face = 0; face < faceCount; face++)
        {
            if ((face & 1023) == 0)
            {
                cancellationToken.ThrowIfCancellationRequested();
            }

            var signedTriangles = reader.ReadInt32("face triangle count");
            if (signedTriangles == int.MinValue)
            {
                throw Invalid("a face triangle count overflows");
            }

            if (signedTriangles == 0)
            {
                continue;
            }

            var isPlanar = signedTriangles > 0;
            var trianglesInFace = Math.Abs(signedTriangles);
            var cornersInFace = checked(trianglesInFace * 3);
            if (writtenCorners > cornerCount - cornersInFace)
            {
                throw Invalid("face triangle counts exceed the geometry header");
            }

            if (isPlanar)
            {
                var normal = ReadPackedNormal(ref reader);
                for (var corner = 0; corner < cornersInFace; corner++)
                {
                    if ((corner & 4095) == 0)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                    }

                    var vertexIndex = ReadVertexIndex(ref reader, vertexCount);
                    WriteVertex(vertices, writtenCorners++, positions[vertexIndex], normal);
                }
            }
            else
            {
                for (var corner = 0; corner < cornersInFace; corner++)
                {
                    if ((corner & 4095) == 0)
                    {
                        cancellationToken.ThrowIfCancellationRequested();
                    }

                    var vertexIndex = ReadVertexIndex(ref reader, vertexCount);
                    var normal = ReadPackedNormal(ref reader);
                    WriteVertex(vertices, writtenCorners++, positions[vertexIndex], normal);
                }
            }
        }

        if (writtenCorners != cornerCount)
        {
            throw Invalid(
                $"faces contain {writtenCorners / 3} triangles but the geometry declares {triangleCount}");
        }

        return new TriangulatedGeometry(vertices, triangleCount, vertexCount, bounds);
    }

    private static int ReadVertexIndex(ref WexReader reader, int vertexCount)
    {
        var index = vertexCount switch
        {
            <= byte.MaxValue => reader.ReadByte("vertex index"),
            <= ushort.MaxValue => reader.ReadUInt16("vertex index"),
            _ => reader.ReadInt32("vertex index"),
        };

        return index >= 0 && index < vertexCount
            ? index
            : throw Invalid($"vertex index {index} is outside geometry with {vertexCount} vertices");
    }

    private static Vector3 ReadPackedNormal(ref WexReader reader)
    {
        const float packSize = 252f;
        var longitude = reader.ReadByte("packed normal longitude") / packSize * MathF.Tau;
        var latitude = reader.ReadByte("packed normal latitude") / packSize * MathF.PI;
        return Vector3.Normalize(new Vector3(
            MathF.Sin(longitude) * MathF.Sin(latitude),
            MathF.Cos(latitude),
            MathF.Cos(longitude) * MathF.Sin(latitude)));
    }

    private static void WriteVertex(
        Span<float> destination,
        int corner,
        Vector3 position,
        Vector3 normal)
    {
        var offset = checked(corner * BimGeometry.FloatsPerVertex);
        destination[offset] = position.X;
        destination[offset + 1] = position.Y;
        destination[offset + 2] = position.Z;
        destination[offset + 3] = normal.X;
        destination[offset + 4] = normal.Y;
        destination[offset + 5] = normal.Z;
    }

    private static void ValidateHeader(Header header, ParseCounters actual)
    {
        if (actual.Shapes != header.Shapes)
        {
            throw Invalid($"the header declares {header.Shapes} shapes but {actual.Shapes} were read");
        }

        if (actual.Vertices != header.Vertices)
        {
            throw Invalid(
                $"the header declares {header.Vertices} vertices but {actual.Vertices} were read");
        }

        if (actual.Triangles != header.Triangles)
        {
            throw Invalid(
                $"the header declares {header.Triangles} triangles but {actual.Triangles} were read");
        }

        if (actual.Matrices != header.Matrices)
        {
            throw Invalid(
                $"the header declares {header.Matrices} matrices but {actual.Matrices} were read");
        }
    }

    private static float ReadColor(ref WexReader reader, string field)
    {
        var value = reader.ReadSingle(field);
        return float.IsFinite(value)
            ? Math.Clamp(value, 0f, 1f)
            : throw Invalid($"{field} is not finite");
    }

    private static float CheckedFloat(double value, string field) =>
        double.IsFinite(value) && value is >= -float.MaxValue and <= float.MaxValue
            ? (float)value
            : throw Invalid($"{field} is outside the supported range");

    private static InvalidDataException Invalid(string message) =>
        new($"Invalid wexBIM file: {message}.");

    private sealed record Header(
        int Shapes,
        int Vertices,
        int Triangles,
        int Matrices,
        int Products,
        int Styles);

    private sealed class ParseCounters
    {
        public int Shapes { get; set; }

        public int Vertices { get; set; }

        public int Triangles { get; set; }

        public int Matrices { get; set; }
    }

    private sealed record TriangulatedGeometry(
        float[] Vertices,
        int TriangleCount,
        int SourceVertexCount,
        BimBounds Bounds);

    private ref struct WexReader(ReadOnlySpan<byte> content)
    {
        private readonly ReadOnlySpan<byte> _content = content;
        private int _position;

        public readonly int Remaining => _content.Length - _position;

        public readonly bool IsAtEnd => _position == _content.Length;

        public byte ReadByte(string field)
        {
            EnsureAvailable(1, field);
            return _content[_position++];
        }

        public short ReadInt16(string field)
        {
            var bytes = ReadBytes(sizeof(short), field);
            return BinaryPrimitives.ReadInt16LittleEndian(bytes);
        }

        public ushort ReadUInt16(string field)
        {
            var bytes = ReadBytes(sizeof(ushort), field);
            return BinaryPrimitives.ReadUInt16LittleEndian(bytes);
        }

        public int ReadInt32(string field)
        {
            var bytes = ReadBytes(sizeof(int), field);
            return BinaryPrimitives.ReadInt32LittleEndian(bytes);
        }

        public long ReadInt64(string field)
        {
            var bytes = ReadBytes(sizeof(long), field);
            return BinaryPrimitives.ReadInt64LittleEndian(bytes);
        }

        public float ReadSingle(string field)
        {
            var value = BitConverter.Int32BitsToSingle(ReadInt32(field));
            return float.IsFinite(value)
                ? value
                : throw Invalid($"{field} is not finite");
        }

        public double ReadDouble(string field)
        {
            var value = BitConverter.Int64BitsToDouble(ReadInt64(field));
            return double.IsFinite(value)
                ? value
                : throw Invalid($"{field} is not finite");
        }

        public Vector3 ReadVector3(string field) => new(
            ReadSingle($"{field} x"),
            ReadSingle($"{field} y"),
            ReadSingle($"{field} z"));

        public int ReadCount(string field, int maximum, bool useInt16 = false)
        {
            var value = useInt16 ? ReadInt16(field) : ReadInt32(field);
            return value is >= 0 && value <= maximum
                ? value
                : throw Invalid($"{field} {value} is outside 0..{maximum}");
        }

        public ReadOnlySpan<byte> ReadBytes(int count, string field)
        {
            EnsureAvailable(count, field);
            var result = _content.Slice(_position, count);
            _position += count;
            return result;
        }

        private readonly void EnsureAvailable(int count, string field)
        {
            if (count < 0 || count > Remaining)
            {
                throw Invalid(
                    $"{field} needs {count} bytes with only {Remaining} remaining");
            }
        }
    }
}
