using System.Buffers.Binary;
using System.Security.Cryptography;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Domain;

/// <summary>
/// Validates and hashes a wexBIM geometry artifact while object storage consumes it.
/// The artifact is derived from an IFC upload on the Windows client, and can still be
/// large enough that buffering it in the API would be the wrong ownership boundary.
/// </summary>
public sealed class WexBimContentStream : Stream
{
    private const int MagicNumber = 94_132_117;
    private const byte MinimumVersion = 1;
    private const byte MaximumVersion = 4;
    private const int HeaderLength = sizeof(int) + sizeof(byte);

    // Borrowed, not owned: the request pipeline owns the body stream.
#pragma warning disable CA2213
    private readonly Stream _inner;
#pragma warning restore CA2213
    private readonly long _maxBytes;
    private readonly IncrementalHash _hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    private readonly byte[] _head = new byte[HeaderLength];
    private int _headLength;
    private bool _headerChecked;
    private string? _contentHash;

    public WexBimContentStream(Stream inner, long maxBytes)
    {
        _inner = inner;
        _maxBytes = maxBytes;
    }

    /// <summary>Bytes seen so far; final once the stream has been read to the end.</summary>
    public long SizeBytes { get; private set; }

    public override bool CanRead => true;

    public override bool CanSeek => false;

    public override bool CanWrite => false;

    public override long Length => throw new NotSupportedException();

    public override long Position
    {
        get => throw new NotSupportedException();
        set => throw new NotSupportedException();
    }

    public string ContentHash() => _contentHash ??= Convert.ToHexStringLower(_hash.GetHashAndReset());

    public override async ValueTask<int> ReadAsync(
        Memory<byte> buffer,
        CancellationToken cancellationToken = default)
    {
        var read = await _inner.ReadAsync(buffer, cancellationToken);
        if (read == 0)
        {
            if (!_headerChecked)
            {
                throw InvalidGeometry();
            }

            return 0;
        }

        SizeBytes += read;
        if (SizeBytes > _maxBytes)
        {
            throw new ApiException("MODEL_011", "MODEL_GEOMETRY_FILE_TOO_LARGE", 413);
        }

        var chunk = buffer.Span[..read];
        InspectHeader(chunk);
        _hash.AppendData(chunk);
        return read;
    }

    public override int Read(byte[] buffer, int offset, int count) =>
        ReadAsync(new Memory<byte>(buffer, offset, count)).AsTask().GetAwaiter().GetResult();

    public override void Flush() => throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

    public override void SetLength(long value) => throw new NotSupportedException();

    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            ContentHash();
            _hash.Dispose();
        }

        base.Dispose(disposing);
    }

    private void InspectHeader(ReadOnlySpan<byte> chunk)
    {
        if (_headerChecked)
        {
            return;
        }

        var take = Math.Min(chunk.Length, _head.Length - _headLength);
        chunk[..take].CopyTo(_head.AsSpan(_headLength));
        _headLength += take;
        if (_headLength < _head.Length)
        {
            return;
        }

        _headerChecked = true;
        var version = _head[sizeof(int)];
        if (BinaryPrimitives.ReadInt32LittleEndian(_head) != MagicNumber
            || version is < MinimumVersion or > MaximumVersion)
        {
            throw InvalidGeometry();
        }
    }

    private static ApiException InvalidGeometry() =>
        new("MODEL_010", "INVALID_WEXBIM_FILE", 422);
}
