using System.Text.Json;

namespace NodeScope.Agent;

internal sealed record Credentials
{
    public required string AgentId { get; init; }

    public required string Token { get; init; }
}

internal static class CredentialsStore
{
    public static void Save(string path, Credentials credentials)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(credentials, AgentJsonContext.Default.Credentials));
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }

    public static Credentials? Load(string path)
    {
        try
        {
            return JsonSerializer.Deserialize(File.ReadAllText(path), AgentJsonContext.Default.Credentials);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }
}
