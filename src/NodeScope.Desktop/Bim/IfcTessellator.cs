using System.Text;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using Xbim.Common;
using Xbim.Geometry.Abstractions;
using Xbim.Ifc;
using Xbim.Ifc4.Interfaces;
using Xbim.ModelGeometry.Scene;

namespace NodeScope.Desktop.Bim;

internal static class IfcImportLimits
{
    public const long MaximumBytes = 209_715_200;
}

/// <summary>The validated portable artifact produced from one IFC source file.</summary>
internal sealed record IfcTessellationResult(
    byte[] WexBim,
    BimScene Scene,
    IReadOnlyList<BuildingModelElementMetadata> Elements);

/// <summary>
/// Replaceable Windows-bound half of Decision 16. Consumers only see the
/// managed wexBIM result, so a future cross-platform engine can replace xBIM
/// without changing upload orchestration or the viewer.
/// </summary>
internal interface IIfcTessellator
{
    public bool IsSupported { get; }

    public Task<IfcTessellationResult> TessellateAsync(
        string sourcePath,
        CancellationToken cancellationToken);
}

/// <summary>
/// xBIM's Open Cascade engine parses and tessellates IFC on Windows. The exact
/// geometry package is pinned because its current netcore build is prerelease
/// and its native assets are Windows-only.
/// </summary>
internal sealed class XbimIfcTessellator(ILoggerFactory loggerFactory) : IIfcTessellator
{
    public bool IsSupported => OperatingSystem.IsWindows();

    public Task<IfcTessellationResult> TessellateAsync(
        string sourcePath,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sourcePath);
        if (!IsSupported)
        {
            throw new PlatformNotSupportedException(
                "IFC import requires NodeScope Desktop on Windows.");
        }

        return Task.Run(
            () => Tessellate(sourcePath, cancellationToken),
            cancellationToken);
    }

    private IfcTessellationResult Tessellate(
        string sourcePath,
        CancellationToken cancellationToken)
    {
        var source = new FileInfo(sourcePath);
        if (!source.Exists)
        {
            throw new FileNotFoundException("The selected IFC file no longer exists.", sourcePath);
        }

        if (source.Length == 0)
        {
            throw new InvalidDataException("The selected IFC file is empty.");
        }

        if (source.Length > IfcImportLimits.MaximumBytes)
        {
            throw new InvalidDataException("The selected IFC exceeds the 200 MiB model limit.");
        }

        ReportProgressDelegate progress = (_, _) => cancellationToken.ThrowIfCancellationRequested();
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var model = IfcStore.Open(sourcePath, progDelegate: progress);
            cancellationToken.ThrowIfCancellationRequested();

            var context = new Xbim3DModelContext(
                model,
                loggerFactory,
                XGeometryEngineVersion.V6);
            if (!context.CreateContext(progress))
            {
                throw new InvalidDataException(
                    "xBIM could not create renderable geometry from this IFC.");
            }

            cancellationToken.ThrowIfCancellationRequested();
            using var output = new MemoryStream();
            using (var writer = new BinaryWriter(output, Encoding.UTF8, leaveOpen: true))
            {
                model.SaveAsWexBim(writer);
                writer.Flush();
            }

            if (output.Length > IfcImportLimits.MaximumBytes)
            {
                throw new InvalidDataException(
                    "The IFC produced geometry larger than the 200 MiB model limit.");
            }

            var wexBim = output.ToArray();
            var scene = WexBimReader.Read(wexBim, cancellationToken);
            var products = model.Instances
                .OfType<IIfcProduct>()
                .ToDictionary(static product => product.EntityLabel);
            var elements = new List<BuildingModelElementMetadata>(scene.Products.Count);
            foreach (var label in scene.Products.Keys.Order())
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (!products.TryGetValue(label, out var product))
                {
                    continue;
                }

                elements.Add(new BuildingModelElementMetadata(
                    label,
                    product.GlobalId.ToString(),
                    product.ExpressType.Name,
                    Truncate(product.Name?.ToString(), 512)));
            }

            return new IfcTessellationResult(wexBim, scene, elements);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception failure)
        {
            throw new InvalidDataException(
                $"The selected IFC could not be tessellated: {failure.Message}",
                failure);
        }
    }

    private static string? Truncate(string? value, int maximumLength) =>
        value is null || value.Length <= maximumLength
            ? value
            : value[..maximumLength];
}
