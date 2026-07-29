using System.Buffers.Binary;
using System.Security.Cryptography;

namespace NodeScope.Backup;

internal static class BackupCryptography
{
    private static readonly byte[] Magic = "NSOB2\r\n"u8.ToArray();
    private const byte AlgorithmRsaOaepSha256Aes256Gcm = 1;
    private const int DataKeySize = 32;
    private const int NoncePrefixSize = 8;
    private const int NonceSize = 12;
    private const int TagSize = 16;
    private const int FrameSize = 1024 * 1024;
    private const int FixedHeaderSize = 7 + 1 + 2 + 4 + NoncePrefixSize;
    private const int HeaderHashSize = 32;
    private const int AadSize = HeaderHashSize + 4 + 4 + 1;

    public static async Task EncryptAsync(
        Stream plaintext,
        Stream ciphertext,
        RSA publicKey,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(plaintext);
        ArgumentNullException.ThrowIfNull(ciphertext);
        ArgumentNullException.ThrowIfNull(publicKey);

        await using var encrypting = await FrameEncryptingStream.CreateAsync(
            ciphertext,
            publicKey,
            leaveOpen: true,
            cancellationToken);
        await plaintext.CopyToAsync(encrypting, cancellationToken);
        await encrypting.CompleteAsync(cancellationToken);
    }

    public static async Task DecryptAsync(
        Stream ciphertext,
        Stream plaintext,
        RSA privateKey,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ciphertext);
        ArgumentNullException.ThrowIfNull(plaintext);
        ArgumentNullException.ThrowIfNull(privateKey);

        var fixedHeader = new byte[FixedHeaderSize];
        await ciphertext.ReadExactlyAsync(fixedHeader, cancellationToken);
        if (!fixedHeader.AsSpan(0, Magic.Length).SequenceEqual(Magic))
        {
            throw new InvalidDataException("The backup does not have a supported NodeScope offsite header.");
        }

        if (fixedHeader[Magic.Length] != AlgorithmRsaOaepSha256Aes256Gcm)
        {
            throw new InvalidDataException("The backup uses an unsupported encryption algorithm.");
        }

        var wrappedLength = BinaryPrimitives.ReadUInt16BigEndian(
            fixedHeader.AsSpan(Magic.Length + 1, sizeof(ushort)));
        var frameSize = BinaryPrimitives.ReadInt32BigEndian(
            fixedHeader.AsSpan(Magic.Length + 1 + sizeof(ushort), sizeof(int)));
        if (wrappedLength is < 128 or > 8192)
        {
            throw new InvalidDataException("The wrapped backup key length is invalid.");
        }

        if (frameSize is < 4096 or > FrameSize)
        {
            throw new InvalidDataException("The encrypted frame size is invalid.");
        }

        var wrappedKey = new byte[wrappedLength];
        await ciphertext.ReadExactlyAsync(wrappedKey, cancellationToken);
        var header = new byte[fixedHeader.Length + wrappedKey.Length];
        fixedHeader.CopyTo(header, 0);
        wrappedKey.CopyTo(header, fixedHeader.Length);
        var headerHash = SHA256.HashData(header);

        byte[] dataKey;
        try
        {
            dataKey = privateKey.Decrypt(wrappedKey, RSAEncryptionPadding.OaepSHA256);
        }
        catch (CryptographicException exception)
        {
            throw new CryptographicException(
                "The recovery identity cannot decrypt this offsite backup.",
                exception);
        }

        if (dataKey.Length != DataKeySize)
        {
            CryptographicOperations.ZeroMemory(dataKey);
            throw new CryptographicException("The decrypted backup data key has an invalid length.");
        }

        var noncePrefix = fixedHeader.AsSpan(FixedHeaderSize - NoncePrefixSize, NoncePrefixSize).ToArray();
        var encryptedFrame = new byte[frameSize];
        var plainFrame = new byte[frameSize];
        var tag = new byte[TagSize];
        var lengthBytes = new byte[sizeof(int)];
        var trailing = new byte[1];
        uint frameIndex = 0;

        try
        {
            using var aes = new AesGcm(dataKey, TagSize);
            while (true)
            {
                await ciphertext.ReadExactlyAsync(lengthBytes, cancellationToken);
                var length = BinaryPrimitives.ReadInt32BigEndian(lengthBytes);
                if (length < 0 || length > frameSize)
                {
                    throw new InvalidDataException("An encrypted backup frame has an invalid length.");
                }

                await ciphertext.ReadExactlyAsync(encryptedFrame.AsMemory(0, length), cancellationToken);
                await ciphertext.ReadExactlyAsync(tag, cancellationToken);

                var nonce = CreateNonce(noncePrefix, frameIndex);
                var final = length == 0;
                var aad = CreateAssociatedData(headerHash, frameIndex, length, final);
                try
                {
                    aes.Decrypt(
                        nonce,
                        encryptedFrame.AsSpan(0, length),
                        tag,
                        plainFrame.AsSpan(0, length),
                        aad);
                }
                catch (CryptographicException exception)
                {
                    throw new CryptographicException(
                        "The offsite backup is corrupted, truncated, or encrypted to another identity.",
                        exception);
                }

                if (final)
                {
                    if (await ciphertext.ReadAsync(trailing, cancellationToken) != 0)
                    {
                        throw new InvalidDataException("The encrypted backup has trailing data.");
                    }

                    break;
                }

                await plaintext.WriteAsync(plainFrame.AsMemory(0, length), cancellationToken);
                if (frameIndex == uint.MaxValue)
                {
                    throw new InvalidDataException("The encrypted backup contains too many frames.");
                }

                frameIndex++;
            }
        }
        catch (EndOfStreamException exception)
        {
            throw new InvalidDataException("The encrypted backup is truncated.", exception);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(dataKey);
            CryptographicOperations.ZeroMemory(plainFrame);
        }
    }

    internal sealed class FrameEncryptingStream : Stream
    {
        private readonly Stream _output;
        private readonly AesGcm _aes;
        private readonly byte[] _dataKey;
        private readonly byte[] _noncePrefix;
        private readonly byte[] _headerHash;
        private readonly byte[] _buffer = new byte[FrameSize];
        private readonly byte[] _encryptedBuffer = new byte[FrameSize];
        private readonly byte[] _tag = new byte[TagSize];
        private readonly byte[] _length = new byte[sizeof(int)];
        private readonly bool _leaveOpen;
        private int _buffered;
        private uint _frameIndex;
        private bool _completed;
        private bool _disposed;

        private FrameEncryptingStream(
            Stream output,
            AesGcm aes,
            byte[] dataKey,
            byte[] noncePrefix,
            byte[] headerHash,
            bool leaveOpen)
        {
            _output = output;
            _aes = aes;
            _dataKey = dataKey;
            _noncePrefix = noncePrefix;
            _headerHash = headerHash;
            _leaveOpen = leaveOpen;
        }

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => !_disposed;
        public override long Length => throw new NotSupportedException();
        public override long Position
        {
            get => throw new NotSupportedException();
            set => throw new NotSupportedException();
        }

        public static async Task<FrameEncryptingStream> CreateAsync(
            Stream output,
            RSA publicKey,
            bool leaveOpen,
            CancellationToken cancellationToken)
        {
            ArgumentNullException.ThrowIfNull(output);
            ArgumentNullException.ThrowIfNull(publicKey);

            var dataKey = RandomNumberGenerator.GetBytes(DataKeySize);
            var noncePrefix = RandomNumberGenerator.GetBytes(NoncePrefixSize);
            byte[] wrappedKey;
            try
            {
                wrappedKey = publicKey.Encrypt(dataKey, RSAEncryptionPadding.OaepSHA256);
            }
            catch
            {
                CryptographicOperations.ZeroMemory(dataKey);
                throw;
            }

            if (wrappedKey.Length > ushort.MaxValue)
            {
                CryptographicOperations.ZeroMemory(dataKey);
                throw new CryptographicException("The public key produced an unsupported wrapped key size.");
            }

            var header = new byte[FixedHeaderSize + wrappedKey.Length];
            Magic.CopyTo(header, 0);
            header[Magic.Length] = AlgorithmRsaOaepSha256Aes256Gcm;
            BinaryPrimitives.WriteUInt16BigEndian(
                header.AsSpan(Magic.Length + 1, sizeof(ushort)),
                checked((ushort)wrappedKey.Length));
            BinaryPrimitives.WriteInt32BigEndian(
                header.AsSpan(Magic.Length + 1 + sizeof(ushort), sizeof(int)),
                FrameSize);
            noncePrefix.CopyTo(header, FixedHeaderSize - NoncePrefixSize);
            wrappedKey.CopyTo(header, FixedHeaderSize);

            try
            {
                await output.WriteAsync(header, cancellationToken);
                return new FrameEncryptingStream(
                    output,
                    new AesGcm(dataKey, TagSize),
                    dataKey,
                    noncePrefix,
                    SHA256.HashData(header),
                    leaveOpen);
            }
            catch
            {
                CryptographicOperations.ZeroMemory(dataKey);
                throw;
            }
        }

        public override async ValueTask WriteAsync(
            ReadOnlyMemory<byte> buffer,
            CancellationToken cancellationToken = default)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_completed)
            {
                throw new InvalidOperationException("The encrypted stream is already complete.");
            }

            while (!buffer.IsEmpty)
            {
                var count = Math.Min(FrameSize - _buffered, buffer.Length);
                buffer[..count].CopyTo(_buffer.AsMemory(_buffered));
                _buffered += count;
                buffer = buffer[count..];
                if (_buffered == FrameSize)
                {
                    await WriteFrameAsync(_buffer.AsMemory(0, _buffered), final: false, cancellationToken);
                    _buffered = 0;
                }
            }
        }

        public async Task CompleteAsync(CancellationToken cancellationToken)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_completed)
            {
                return;
            }

            if (_buffered > 0)
            {
                await WriteFrameAsync(_buffer.AsMemory(0, _buffered), final: false, cancellationToken);
                _buffered = 0;
            }

            await WriteFrameAsync(ReadOnlyMemory<byte>.Empty, final: true, cancellationToken);
            await _output.FlushAsync(cancellationToken);
            _completed = true;
        }

        private async Task WriteFrameAsync(
            ReadOnlyMemory<byte> plaintext,
            bool final,
            CancellationToken cancellationToken)
        {
            var nonce = CreateNonce(_noncePrefix, _frameIndex);
            var aad = CreateAssociatedData(_headerHash, _frameIndex, plaintext.Length, final);
            _aes.Encrypt(
                nonce,
                plaintext.Span,
                _encryptedBuffer.AsSpan(0, plaintext.Length),
                _tag,
                aad);

            BinaryPrimitives.WriteInt32BigEndian(_length, plaintext.Length);
            await _output.WriteAsync(_length, cancellationToken);
            await _output.WriteAsync(
                _encryptedBuffer.AsMemory(0, plaintext.Length),
                cancellationToken);
            await _output.WriteAsync(_tag, cancellationToken);

            if (!final)
            {
                if (_frameIndex == uint.MaxValue)
                {
                    throw new InvalidOperationException("The plaintext is too large for the backup format.");
                }

                _frameIndex++;
            }
        }

        public override void Flush() => _output.Flush();

        public override Task FlushAsync(CancellationToken cancellationToken) =>
            _output.FlushAsync(cancellationToken);

        public override void Write(byte[] buffer, int offset, int count)
        {
            ArgumentNullException.ThrowIfNull(buffer);
            WriteAsync(buffer.AsMemory(offset, count)).AsTask().GetAwaiter().GetResult();
        }

        public override int Read(byte[] buffer, int offset, int count) =>
            throw new NotSupportedException();

        public override long Seek(long offset, SeekOrigin origin) =>
            throw new NotSupportedException();

        public override void SetLength(long value) =>
            throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (!_disposed && disposing)
            {
                _aes.Dispose();
                CryptographicOperations.ZeroMemory(_dataKey);
                CryptographicOperations.ZeroMemory(_buffer);
                CryptographicOperations.ZeroMemory(_encryptedBuffer);
                if (!_leaveOpen)
                {
                    _output.Dispose();
                }
            }

            _disposed = true;
            base.Dispose(disposing);
        }

        public override async ValueTask DisposeAsync()
        {
            if (!_disposed)
            {
                _aes.Dispose();
                CryptographicOperations.ZeroMemory(_dataKey);
                CryptographicOperations.ZeroMemory(_buffer);
                CryptographicOperations.ZeroMemory(_encryptedBuffer);
                if (!_leaveOpen)
                {
                    await _output.DisposeAsync();
                }
            }

            _disposed = true;
            await base.DisposeAsync();
            GC.SuppressFinalize(this);
        }
    }

    private static byte[] CreateNonce(ReadOnlySpan<byte> prefix, uint frameIndex)
    {
        var nonce = new byte[NonceSize];
        prefix.CopyTo(nonce);
        BinaryPrimitives.WriteUInt32BigEndian(nonce.AsSpan(NoncePrefixSize), frameIndex);
        return nonce;
    }

    private static byte[] CreateAssociatedData(
        ReadOnlySpan<byte> headerHash,
        uint frameIndex,
        int plaintextLength,
        bool final)
    {
        var associatedData = new byte[AadSize];
        headerHash.CopyTo(associatedData);
        BinaryPrimitives.WriteUInt32BigEndian(
            associatedData.AsSpan(HeaderHashSize, sizeof(uint)),
            frameIndex);
        BinaryPrimitives.WriteInt32BigEndian(
            associatedData.AsSpan(HeaderHashSize + sizeof(uint), sizeof(int)),
            plaintextLength);
        associatedData[^1] = final ? (byte)1 : (byte)0;
        return associatedData;
    }
}
