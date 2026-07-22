using NodeScope.Agent;

var deps = new CliDependencies
{
    Enroll = async options =>
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        return await Enrollment.EnrollAsync(http, options);
    },
    SaveCredentials = CredentialsStore.Save,
    RunDaemon = Daemon.RunAsync,
    Log = Console.WriteLine,
};

return await Cli.RunAsync(args, deps);
