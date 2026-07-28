using System.Buffers.Binary;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NodeScope.Migrations;
using NodeScope.Migrations.Entities;
using NodeScope.Platform;
using NodeScope.Platform.Abstractions;

namespace NodeScope.Api;

/// <summary>
/// The dev/demo seed (`dotnet NodeScope.Api.dll seed`), ported from the Node
/// <c>prisma/seed.ts</c> + <c>scripts/load-sample-model.mjs</c> pair: the Acme Networks
/// org with its site tree, network, devices and placeholder building model, the
/// credential-less super-admin, and (with <c>SEED_SAMPLE_MODEL=true</c>) a real IFC
/// uploaded through the product API. Idempotent throughout - every step skips when its
/// output already exists, exactly like the Node seed.
/// </summary>
/// <remarks>
/// Database writes go through <see cref="MigrationsDbContext"/> (the one full model of the
/// schema), mirroring seed.ts's direct Prisma writes. The two steps Node routed through
/// the app instead of the database - the owner sign-up (Argon2 credential records)
/// and the sample-model upload - run against THIS host started on a loopback port, so the
/// seed exercises the same code paths a real client does.
/// </remarks>
internal static partial class DemoSeeder
{
    private const string OrgName = "Acme Networks";
    private const string SuperAdminEmail = "admin@nodescope.test";
    private const string DefaultSampleModelUrl =
        "https://raw.githubusercontent.com/xBimTeam/XbimEssentials/e3c877712aeff39813219b9dd13383c266d07055/Tests/TestFiles/SampleHouse4.ifc";
    private const string DefaultSampleGeometryUrl =
        "https://raw.githubusercontent.com/xBimTeam/XbimWebUI/57a4785f31920dbc291cab417137d66a16860853/tests/data/SampleHouse.wexbim";
    private const int WexBimMagicNumber = 94_132_117;
    private static readonly byte[] PlaceholderIfc =
        Encoding.ASCII.GetBytes("ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");

    /// <summary>Column values for the schema's timestamp(3)-without-time-zone columns: UTC wall time, Kind=Unspecified.</summary>
    private static DateTime Now => DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Unspecified);

    private static string NewId() => Guid.NewGuid().ToString();

    public static async Task RunAsync(WebApplication app)
    {
        var configuration = app.Configuration;
        var password = configuration["SEED_PASSWORD"]
            ?? throw new InvalidOperationException("SEED_PASSWORD env var is required");
        var ownerEmail = configuration["SEED_EMAIL"] ?? "owner@acme.test";
        var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("NodeScope.Api.DemoSeeder");

        // The seed talks to its own API for the steps Node routed through the app.
        app.Urls.Clear();
        app.Urls.Add("http://127.0.0.1:0");
        await app.StartAsync().ConfigureAwait(false);
        using var http = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        var connectionString = app.Services.GetRequiredService<DatabaseConnectionString>().Value;
        using var db = new MigrationsDbContext(MigrationsDbContextOptions.Create(connectionString));
        var storage = app.Services.GetRequiredService<IObjectStorage>();

        var org = await EnsureOrganizationAsync(db, logger).ConfigureAwait(false);
        await EnsureSuperAdminAsync(db, logger).ConfigureAwait(false);
        var ownerId = await EnsureOwnerAsync(db, http, ownerEmail, password, logger).ConfigureAwait(false);
        await EnsureMembershipAsync(db, org.Id, ownerId, logger).ConfigureAwait(false);
        await SeedNetworkDataAsync(db, org.Id, ownerId, logger).ConfigureAwait(false);
        await SeedBuildingModelAsync(db, storage, org.Id, logger).ConfigureAwait(false);

        if (string.Equals(configuration["SEED_SAMPLE_MODEL"], "true", StringComparison.OrdinalIgnoreCase))
        {
            await UploadSampleModelAsync(
                db, storage, org.Id, http, configuration, ownerEmail, password, logger).ConfigureAwait(false);
        }

        await app.StopAsync().ConfigureAwait(false);
        LogDone(logger);
    }

    private static async Task<Organization> EnsureOrganizationAsync(MigrationsDbContext db, ILogger logger)
    {
        var org = await db.Organization.FirstOrDefaultAsync(o => o.Name == OrgName).ConfigureAwait(false);
        if (org is not null)
        {
            LogSkipped(logger, "organization");
            return org;
        }

        org = new Organization { Id = NewId(), Name = OrgName, UpdatedAt = Now };
        db.Organization.Add(org);
        db.OrganizationDomain.Add(new OrganizationDomain
        {
            Id = NewId(),
            OrganizationId = org.Id,
            Domain = "acme.test",
            Verified = true,
        });
        await db.SaveChangesAsync().ConfigureAwait(false);
        LogCreated(logger, $"organization: {OrgName}");
        return org;
    }

    private static async Task EnsureSuperAdminAsync(MigrationsDbContext db, ILogger logger)
    {
        var admin = await db.User.FirstOrDefaultAsync(u => u.Email == SuperAdminEmail).ConfigureAwait(false);
        if (admin is null)
        {
            db.User.Add(new User
            {
                Id = NewId(),
                Email = SuperAdminEmail,
                EmailVerified = true,
                Name = "Platform Admin",
                IsSuperAdmin = true,
                UpdatedAt = Now,
            });
        }
        else
        {
            admin.IsSuperAdmin = true;
        }

        await db.SaveChangesAsync().ConfigureAwait(false);
        LogCreated(logger, $"super-admin: {SuperAdminEmail}");
    }

    /// <summary>
    /// Signs the owner up through the live auth surface (the one step that needs argon2
    /// and the credential row shapes), then reads the id back like any other row.
    /// </summary>
    private static async Task<string> EnsureOwnerAsync(
        MigrationsDbContext db, HttpClient http, string email, string password, ILogger logger)
    {
        var existing = await db.User.FirstOrDefaultAsync(u => u.Email == email).ConfigureAwait(false);
        if (existing is not null)
        {
            LogSkipped(logger, "owner sign-up");
            return existing.Id;
        }

        using var body = JsonContent.Create(new { name = "Acme Owner", email, password });
        using var response = await http.PostAsync(new Uri("/api/v1/auth/sign-up", UriKind.Relative), body).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Owner sign-up failed: HTTP {(int)response.StatusCode} {await response.Content.ReadAsStringAsync().ConfigureAwait(false)}");
        }

        var owner = await db.User.FirstAsync(u => u.Email == email).ConfigureAwait(false);
        var created = $"owner user: {email}";
        LogCreated(logger, created);
        return owner.Id;
    }

    private static async Task EnsureMembershipAsync(MigrationsDbContext db, string orgId, string ownerId, ILogger logger)
    {
        if (await db.OrganizationMember.AnyAsync(m => m.UserId == ownerId).ConfigureAwait(false))
        {
            LogSkipped(logger, "membership");
            return;
        }

        db.OrganizationMember.Add(new OrganizationMember
        {
            Id = NewId(),
            UserId = ownerId,
            OrganizationId = orgId,
            Role = OrgRole.Owner,
            UpdatedAt = Now,
        });
        await db.SaveChangesAsync().ConfigureAwait(false);
        LogCreated(logger, $"owner linked to {OrgName} as OWNER");
    }

    private static async Task SeedNetworkDataAsync(MigrationsDbContext db, string orgId, string ownerId, ILogger logger)
    {
        if (await db.Device.AnyAsync(d => d.OrganizationId == orgId).ConfigureAwait(false))
        {
            LogSkipped(logger, "network data");
            return;
        }

        Property NewProperty(string name, PropertyType type, string? parentId) => new()
        {
            Id = NewId(),
            OrganizationId = orgId,
            Name = name,
            Type = type,
            ParentId = parentId,
            UpdatedAt = Now,
        };

        var site = NewProperty("Acme HQ", PropertyType.Site, null);
        var building = NewProperty("Main Building", PropertyType.Building, site.Id);
        var floor1 = NewProperty("Ground Floor", PropertyType.Floor, building.Id);
        var floor2 = NewProperty("Server Room", PropertyType.Floor, building.Id);
        db.Property.AddRange(site, building, floor1, floor2);

        var network = new Network
        {
            Id = NewId(),
            OrganizationId = orgId,
            UserId = ownerId,
            Name = "Acme Corporate LAN",
            HomeAddress = "123 Corporate Blvd, New York, NY",
            UpdatedAt = Now,
        };
        db.Network.Add(network);
        db.NetworkProperty.Add(new NetworkProperty
        {
            Id = NewId(),
            OrganizationId = orgId,
            NetworkId = network.Id,
            PropertyId = site.Id,
        });

        Device NewDevice(
            string propertyId, string name, DeviceCategory category, double lat, double lon, string ip,
            string? roleCode = null, int? floor = null, string? floorLabel = null, string? notes = null) => new()
            {
                Id = NewId(),
                OrganizationId = orgId,
                UserId = ownerId,
                NetworkId = network.Id,
                PropertyId = propertyId,
                Name = name,
                Category = category,
                Latitude = lat,
                Longitude = lon,
                IpAddress = ip,
                RoleCode = roleCode,
                Floor = floor,
                FloorLabel = floorLabel,
                Notes = notes,
                UpdatedAt = Now,
            };

        var router = NewDevice(floor1.Id, "Core Router", DeviceCategory.Router, 40.7128, -74.006, "192.168.1.1",
            roleCode: "CORE_ROUTER", notes: "Main gateway router");
        var switch1 = NewDevice(floor1.Id, "Core Switch", DeviceCategory.Switch, 40.7129, -74.0061, "192.168.1.2",
            floor: 1, floorLabel: "Ground Floor");
        var ap = NewDevice(floor1.Id, "Office AP", DeviceCategory.AccessPoint, 40.713, -74.0062, "192.168.1.10",
            floor: 1, floorLabel: "Ground Floor");
        var server = NewDevice(floor2.Id, "File Server", DeviceCategory.ServerRack, 40.7131, -74.0063, "192.168.1.20",
            roleCode: "PRIMARY_STORAGE", floor: 2, floorLabel: "Server Room");
        var firewall = NewDevice(floor1.Id, "Firewall", DeviceCategory.Firewall, 40.7127, -74.0059, "192.168.1.254");
        db.Device.AddRange(router, switch1, ap, server, firewall);

        DeviceConnection NewConnection(string sourceId, string targetId, string? notes) => new()
        {
            Id = NewId(),
            OrganizationId = orgId,
            UserId = ownerId,
            SourceDeviceId = sourceId,
            TargetDeviceId = targetId,
            ConnectionType = ConnectionType.Ethernet,
            Notes = notes,
            UpdatedAt = Now,
        };

        db.DeviceConnection.AddRange(
            NewConnection(router.Id, switch1.Id, "Uplink from router to core switch"),
            NewConnection(switch1.Id, server.Id, null));

        db.FiberRun.Add(new FiberRun
        {
            Id = NewId(),
            OrganizationId = orgId,
            UserId = ownerId,
            Name = "MDF to IDF Run",
            StartDeviceId = router.Id,
            EndDeviceId = server.Id,
            CableType = "OS2 Singlemode",
            LengthMeters = 45.5,
            Notes = "Runs through conduit in east wall",
            UpdatedAt = Now,
        });

        db.Circuit.Add(new Circuit
        {
            Id = NewId(),
            OrganizationId = orgId,
            UserId = ownerId,
            IspName = "Comcast Business",
            CircuitId = "CX-123456789",
            ServiceType = "Fiber",
            Bandwidth = 1000,
            DeviceId = router.Id,
            Notes = "1 Gbps symmetric fiber circuit",
            UpdatedAt = Now,
        });

        await db.SaveChangesAsync().ConfigureAwait(false);
        LogCreated(logger, "site tree, 1 network, charter, 5 devices, 2 connections, 1 fiber run, 1 circuit");
    }

    private static async Task SeedBuildingModelAsync(
        MigrationsDbContext db, IObjectStorage storage, string orgId, ILogger logger)
    {
        var building = await db.Property
            .FirstOrDefaultAsync(p => p.OrganizationId == orgId && p.Name == "Main Building" && p.Type == PropertyType.Building)
            .ConfigureAwait(false);
        if (building is null)
        {
            LogSkipped(logger, "building model (no Main Building)");
            return;
        }

        if (await db.BuildingModel.AnyAsync(m => m.OrganizationId == orgId && m.PropertyId == building.Id).ConfigureAwait(false))
        {
            LogSkipped(logger, "building model");
            return;
        }

        var versionId = NewId();
        var storageKey = StorageKeys.BuildingModelVersion(orgId, building.Id, versionId);
        using (var content = new MemoryStream(PlaceholderIfc))
        {
            await storage.PutAsync(storageKey, content, "application/octet-stream", CancellationToken.None).ConfigureAwait(false);
        }

        var model = new BuildingModel
        {
            Id = NewId(),
            OrganizationId = orgId,
            PropertyId = building.Id,
            Name = "Main Building",
            UpdatedAt = Now,
        };
        db.BuildingModel.Add(model);
        db.BuildingModelVersion.Add(new BuildingModelVersion
        {
            Id = versionId,
            OrganizationId = orgId,
            BuildingModelId = model.Id,
            VersionNumber = 1,
            StorageKey = storageKey,
            FileName = "model.ifc",
            ContentHash = Convert.ToHexStringLower(SHA256.HashData(PlaceholderIfc)),
            SizeBytes = PlaceholderIfc.Length,
        });
        await db.SaveChangesAsync().ConfigureAwait(false);

        model.ActiveVersionId = versionId;
        model.Version += 1;

        var coreSwitch = await db.Device
            .FirstOrDefaultAsync(d => d.OrganizationId == orgId && d.Name == "Core Switch")
            .ConfigureAwait(false);
        if (coreSwitch is not null)
        {
            coreSwitch.X = 5.0;
            coreSwitch.Y = 3.2;
            coreSwitch.Z = 1.5;
        }

        await db.SaveChangesAsync().ConfigureAwait(false);
        LogCreated(logger, "building model (Main Building v1, active) + 3D coords on Core Switch");
    }

    /// <summary>
    /// Puts a real IFC and its matched portable wexBIM geometry behind "Main Building"
    /// through the product API, so every supported desktop can render the sample. Needs
    /// internet on the first run.
    /// </summary>
    private static async Task UploadSampleModelAsync(
        MigrationsDbContext db,
        IObjectStorage storage,
        string organizationId,
        HttpClient http,
        IConfiguration configuration,
        string email,
        string password,
        ILogger logger)
    {
        var configuredModelUrl = NullIfWhiteSpace(configuration["SEED_SAMPLE_MODEL_URL"]);
        var configuredGeometryUrl = NullIfWhiteSpace(configuration["SEED_SAMPLE_MODEL_GEOMETRY_URL"]);
        if ((configuredModelUrl is null) != (configuredGeometryUrl is null))
        {
            throw new InvalidOperationException(
                "SEED_SAMPLE_MODEL_URL and SEED_SAMPLE_MODEL_GEOMETRY_URL must be set together");
        }

        var sampleUri = RequireSampleUri(configuredModelUrl ?? DefaultSampleModelUrl, "sample model");
        var geometryUri = RequireSampleUri(
            configuredGeometryUrl ?? DefaultSampleGeometryUrl,
            "sample geometry");
        var sampleFileName = Path.GetFileName(sampleUri.LocalPath);

        var buildingModel = await db.BuildingModel
            .Where(model => model.OrganizationId == organizationId)
            .Join(
                db.Property.Where(property =>
                    property.OrganizationId == organizationId
                    && property.Name == "Main Building"
                    && property.Type == PropertyType.Building),
                model => model.PropertyId,
                property => property.Id,
                (model, property) => new
                {
                    ModelId = model.Id,
                    PropertyId = property.Id,
                })
            .SingleOrDefaultAsync()
            .ConfigureAwait(false)
            ?? throw new InvalidOperationException("Main Building model not found; did the seed run?");

        var existingVersion = await db.BuildingModelVersion
            .Where(version =>
                version.OrganizationId == organizationId
                && version.BuildingModelId == buildingModel.ModelId
                && version.FileName == sampleFileName)
            .OrderByDescending(version => version.VersionNumber)
            .FirstOrDefaultAsync()
            .ConfigureAwait(false);
        var geometryAlreadyExists = existingVersion is not null
            && await storage.ExistsAsync(
                StorageKeys.BuildingModelGeometry(
                    organizationId,
                    buildingModel.PropertyId,
                    existingVersion.Id),
                CancellationToken.None)
            .ConfigureAwait(false);
        if (geometryAlreadyExists)
        {
            LogSkipped(logger, "sample model with portable geometry");
            return;
        }

        byte[]? modelBytes = null;
        if (existingVersion is null)
        {
            modelBytes = await DownloadSampleAsync(http, sampleUri).ConfigureAwait(false);
            if (!Encoding.ASCII.GetString(modelBytes, 0, Math.Min(13, modelBytes.Length))
                .StartsWith("ISO-10303-21", StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"{sampleUri} does not look like an IFC (missing ISO-10303-21 header)");
            }
        }

        var geometryBytes = await DownloadSampleAsync(http, geometryUri).ConfigureAwait(false);
        if (geometryBytes.Length < sizeof(int) + sizeof(byte)
            || BinaryPrimitives.ReadInt32LittleEndian(geometryBytes) != WexBimMagicNumber
            || geometryBytes[sizeof(int)] is < 1 or > 4)
        {
            throw new InvalidOperationException($"{geometryUri} does not look like a supported wexBIM file");
        }

        using var signInBody = JsonContent.Create(new { email, password });
        using var signIn = await http.PostAsync(
            new Uri("/api/v1/auth/sign-in", UriKind.Relative), signInBody).ConfigureAwait(false);
        if (!signIn.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"Sample-model sign-in failed: HTTP {(int)signIn.StatusCode}");
        }

        using var signInJson = JsonDocument.Parse(await signIn.Content.ReadAsStringAsync().ConfigureAwait(false));
        var sessionToken = signInJson.RootElement.GetProperty("data").GetProperty("token").GetString()
            ?? throw new InvalidOperationException("Sample-model sign-in returned no session token");

        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", sessionToken);

        var buildingId = Uri.EscapeDataString(buildingModel.PropertyId);
        var versionId = existingVersion?.Id;
        if (versionId is null)
        {
            using var upload = new ByteArrayContent(modelBytes!);
            upload.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            using var uploadResponse = await http.PostAsync(
                new Uri(
                    $"/api/v1/buildings/{buildingId}/model/versions"
                    + $"?fileName={Uri.EscapeDataString(sampleFileName)}&activate=false",
                    UriKind.Relative),
                upload).ConfigureAwait(false);
            uploadResponse.EnsureSuccessStatusCode();
            using var uploaded = JsonDocument.Parse(
                await uploadResponse.Content.ReadAsStringAsync().ConfigureAwait(false));
            versionId = uploaded.RootElement.GetProperty("data").GetProperty("id").GetString()
                ?? throw new InvalidOperationException("Sample-model upload returned no version id");
        }

        using var geometry = new ByteArrayContent(geometryBytes);
        geometry.Headers.ContentType = new MediaTypeHeaderValue("application/vnd.xbim.wexbim");
        using var geometryResponse = await http.PutAsync(
            new Uri(
                $"/api/v1/buildings/{buildingId}/model/versions/{Uri.EscapeDataString(versionId)}/geometry",
                UriKind.Relative),
            geometry).ConfigureAwait(false);
        geometryResponse.EnsureSuccessStatusCode();

        using var activateBody = JsonContent.Create(new { versionId });
        using var activateResponse = await http.PutAsync(
            new Uri($"/api/v1/buildings/{buildingId}/model/active", UriKind.Relative), activateBody).ConfigureAwait(false);
        activateResponse.EnsureSuccessStatusCode();
        var summary = existingVersion is null
            ? $"sample model and portable geometry uploaded and activated ({modelBytes!.Length} IFC bytes, {geometryBytes.Length} wexBIM bytes)"
            : $"sample model geometry repaired and activated ({geometryBytes.Length} wexBIM bytes)";
        LogCreated(logger, summary);
    }

    private static string? NullIfWhiteSpace(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    private static Uri RequireSampleUri(string value, string description)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || string.IsNullOrWhiteSpace(Path.GetFileName(uri.LocalPath)))
        {
            throw new InvalidOperationException($"{value} has no {description} file name");
        }

        return uri;
    }

    private static async Task<byte[]> DownloadSampleAsync(HttpClient http, Uri uri)
    {
        var cache = Path.Combine(
            Path.GetTempPath(),
            "nodescope-samples",
            Path.GetFileName(uri.LocalPath));
        if (File.Exists(cache))
        {
            return await File.ReadAllBytesAsync(cache).ConfigureAwait(false);
        }

        var bytes = await http.GetByteArrayAsync(uri).ConfigureAwait(false);
        Directory.CreateDirectory(Path.GetDirectoryName(cache)!);
        await File.WriteAllBytesAsync(cache, bytes).ConfigureAwait(false);
        return bytes;
    }

    [LoggerMessage(Level = LogLevel.Information, Message = "Seeded: {What}")]
    private static partial void LogCreated(ILogger logger, string what);

    [LoggerMessage(Level = LogLevel.Information, Message = "Already present - skipping: {What}")]
    private static partial void LogSkipped(ILogger logger, string what);

    [LoggerMessage(Level = LogLevel.Information, Message = "Seed complete")]
    private static partial void LogDone(ILogger logger);
}
