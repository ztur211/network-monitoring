namespace NodeScope.Backup;

internal static class PrivateFile
{
    public static FileStreamOptions CreateWriteOptions()
    {
        var options = new FileStreamOptions
        {
            Mode = FileMode.CreateNew,
            Access = FileAccess.Write,
            Share = FileShare.None,
            BufferSize = 128 * 1024,
            Options = FileOptions.Asynchronous | FileOptions.SequentialScan,
        };
        if (!OperatingSystem.IsWindows())
        {
            options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        }

        return options;
    }
}
