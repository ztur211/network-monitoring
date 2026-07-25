namespace NodeScope.Desktop.Hosting;

/// <summary>
/// Buffers activation messages that arrive before the UI is ready to handle them - the
/// process's own argv URI is posted from Main, well before Avalonia constructs the App.
/// </summary>
internal sealed class ActivationQueue
{
    private readonly Lock _sync = new();
    private readonly Queue<string> _buffered = new();
    private Action<string>? _handler;

    public void Post(string message)
    {
        Action<string>? handler;
        lock (_sync)
        {
            handler = _handler;
            if (handler is null)
            {
                _buffered.Enqueue(message);
                return;
            }
        }

        handler(message);
    }

    /// <summary>Installs the handler and drains anything buffered, in arrival order.</summary>
    public void Subscribe(Action<string> handler)
    {
        List<string> drained;
        lock (_sync)
        {
            _handler = handler;
            drained = [.. _buffered];
            _buffered.Clear();
        }

        foreach (var message in drained)
        {
            handler(message);
        }
    }
}
