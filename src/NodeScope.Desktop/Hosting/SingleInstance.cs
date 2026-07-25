using System.Net.Sockets;
using System.Text;

namespace NodeScope.Desktop.Hosting;

/// <summary>
/// One running client per user. The OS delivers nodescope:// activations by launching the
/// registered executable with the URI as an argument; when an instance already runs, the
/// new process forwards that URI (or a bare focus request) over a Unix domain socket and
/// exits, so the callback lands in the window the user started the sign-in from.
/// </summary>
/// <remarks>
/// A UDS in app data on both OSes (Windows supports AF_UNIX since Win10 1803): binding the
/// socket IS the single-instance mutex, so a normal launch pays no probe timeout. A stale
/// socket file from a crash makes Bind fail while Connect also fails - Program resolves
/// that by deleting the file and binding again. Messages are newline-terminated UTF-8.
/// </remarks>
internal sealed class SingleInstance : IDisposable
{
    /// <summary>The bare focus request a second instance sends when it has no URI.</summary>
    public const string ActivateMessage = "activate";

    private readonly Socket _listener;
    private readonly string _socketPath;
    private readonly Task _accepting;

    private SingleInstance(Socket listener, string socketPath, Action<string> onMessage)
    {
        _listener = listener;
        _socketPath = socketPath;
        _accepting = AcceptLoopAsync(listener, onMessage);
    }

    public static string DefaultSocketPath { get; } = Path.Combine(DesktopPaths.DataDirectory, "instance.sock");

    /// <summary>
    /// Binds the socket and becomes the primary, or returns null when the address is taken
    /// (a live primary - or a stale file; the caller disambiguates via <see cref="TryForward"/>).
    /// <paramref name="onMessage"/> runs on a worker thread; the caller dispatches.
    /// </summary>
    public static SingleInstance? TryStartPrimary(string socketPath, Action<string> onMessage)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(socketPath)!);
        var listener = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        try
        {
            listener.Bind(new UnixDomainSocketEndPoint(socketPath));
            listener.Listen(backlog: 4);
        }
        catch (SocketException)
        {
            listener.Dispose();
            return null;
        }

        return new SingleInstance(listener, socketPath, onMessage);
    }

    /// <summary>Delivers <paramref name="message"/> to the primary; false when nothing listens.</summary>
    public static bool TryForward(string socketPath, string message)
    {
        using var client = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
        try
        {
            client.Connect(new UnixDomainSocketEndPoint(socketPath));
            client.Send(Encoding.UTF8.GetBytes(message + "\n"));
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    public void Dispose()
    {
        _listener.Dispose();
        try
        {
            _accepting.Wait(TimeSpan.FromSeconds(2));
        }
        catch (AggregateException)
        {
            // The loop observed the listener disposal; that is the expected way out.
        }

        // Closing a UDS does not unlink its file; leaving it would strand the NEXT launch
        // on the stale-socket recovery path.
        try
        {
            File.Delete(_socketPath);
        }
        catch (IOException)
        {
            // Recoverable at next startup.
        }
    }

    private static async Task AcceptLoopAsync(Socket listener, Action<string> onMessage)
    {
        while (true)
        {
            Socket connection;
            try
            {
                connection = await listener.AcceptAsync();
            }
            catch (Exception failure) when (failure is SocketException or ObjectDisposedException)
            {
                return; // listener closed: shutdown
            }

            try
            {
                using var stream = new NetworkStream(connection, ownsSocket: true);
                using var reader = new StreamReader(stream, Encoding.UTF8);
                while (await reader.ReadLineAsync() is { Length: > 0 } line)
                {
                    onMessage(line);
                }
            }
            catch (IOException)
            {
                // A secondary died mid-send; nothing to deliver, keep listening.
            }
        }
    }
}
