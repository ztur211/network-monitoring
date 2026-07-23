using System.Security.Cryptography;
using System.Text;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Modules.Inventory.Domain;

/// <summary>
/// Wraps an upload so the size cap, the IFC magic prefix, and the sha256 are all evaluated as
/// the bytes flow past on their way to storage. A model can be hundreds of megabytes, so it is
/// never buffered whole - which is also why the checks cannot happen before the write starts.
/// </summary>
public sealed class IfcContentStream : Stream
{
    private static readonly byte[] IfcMagic = Encoding.Latin1.GetBytes("ISO-10303-21;");

    // Borrowed, not owned: the request pipeline owns the body stream and closes it, so this
    // wrapper must not (CA2213 assumes ownership).
#pragma warning disable CA2213
    private readonly Stream _inner;
#pragma warning restore CA2213
    private readonly long _maxBytes;
    private readonly IncrementalHash _hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    private readonly byte[] _head = new byte[IfcMagic.Length];
    private int _headLength;
    private bool _magicChecked;
    private string? _contentHash;

    public IfcContentStream(Stream inner, long maxBytes)
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

    /// <summary>
    /// The content hash, computed once. Finalized on dispose as well, because the storage client
    /// may close the stream before the caller asks for it.
    /// </summary>
    public string ContentHash() => _contentHash ??= Convert.ToHexStringLower(_hash.GetHashAndReset());

    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        var read = await _inner.ReadAsync(buffer, cancellationToken);
        if (read == 0)
        {
            // A file shorter than the magic prefix never got to prove itself.
            if (!_magicChecked)
            {
                throw InvalidIfc();
            }

            return 0;
        }

        SizeBytes += read;
        if (SizeBytes > _maxBytes)
        {
            throw new ApiException("MODEL_006", "MODEL_FILE_TOO_LARGE", 413);
        }

        var chunk = buffer.Span[..read];
        InspectMagic(chunk);
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

    private void InspectMagic(ReadOnlySpan<byte> chunk)
    {
        if (_magicChecked)
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

        _magicChecked = true;
        if (!_head.AsSpan().SequenceEqual(IfcMagic))
        {
            throw InvalidIfc();
        }
    }

    private static ApiException InvalidIfc() => new("MODEL_007", "INVALID_IFC_FILE", 422);
}
