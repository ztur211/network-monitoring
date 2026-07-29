namespace NodeScope.Backup;

internal static class BackupCli
{
    public static async Task<int> RunAsync(string[] args, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(args);
        try
        {
            return args.FirstOrDefault() switch
            {
                "keygen" => RunKeygen(args),
                "push" => await RunPushAsync(args, cancellationToken),
                "pull" => await RunPullAsync(args, cancellationToken),
                "list" => await RunListAsync(args, cancellationToken),
                _ => Usage(),
            };
        }
        catch (Exception exception) when (
            exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            await Console.Error.WriteLineAsync($"[offsite] ERROR: {exception.Message}");
            return 1;
        }
    }

    private static int RunKeygen(string[] args)
    {
        if (args.Length != 1)
        {
            return Usage();
        }

        var identity = OffsiteIdentity.Generate();
        Console.WriteLine($"PUBKEY={identity.PublicKey}");
        Console.WriteLine($"PRIVKEY={identity.PrivateKey}");
        return 0;
    }

    private static async Task<int> RunPushAsync(
        string[] args,
        CancellationToken cancellationToken)
    {
        if (args.Length != 2)
        {
            return Usage();
        }

        var options = OffsiteOptions.FromEnvironment();
        using var store = new S3BackupStore(options);
        var service = new OffsiteBackupService(options, store);
        var key = await service.PushAsync(args[1], cancellationToken);
        Console.WriteLine(key);
        return 0;
    }

    private static async Task<int> RunPullAsync(
        string[] args,
        CancellationToken cancellationToken)
    {
        if (args.Length != 3)
        {
            return Usage();
        }

        var privateKey = Environment.GetEnvironmentVariable("OFFSITE_IDENTITY");
        if (string.IsNullOrWhiteSpace(privateKey))
        {
            throw new InvalidOperationException("OFFSITE_IDENTITY is required to decrypt a backup.");
        }

        var options = OffsiteOptions.FromEnvironment();
        using var store = new S3BackupStore(options);
        var service = new OffsiteBackupService(options, store);
        await service.PullAsync(args[1], args[2], privateKey, cancellationToken);
        Console.WriteLine(args[2]);
        return 0;
    }

    private static async Task<int> RunListAsync(
        string[] args,
        CancellationToken cancellationToken)
    {
        if (args.Length != 1)
        {
            return Usage();
        }

        var options = OffsiteOptions.FromEnvironment();
        using var store = new S3BackupStore(options);
        var service = new OffsiteBackupService(options, store);
        foreach (var backup in await service.ListAsync(cancellationToken))
        {
            Console.WriteLine(service.DisplayName(backup));
        }

        return 0;
    }

    private static int Usage()
    {
        Console.Error.WriteLine(
            "Usage: NodeScope.Backup keygen | push <bundle-dir> | list | pull <name> <destination-dir>");
        return 2;
    }
}
