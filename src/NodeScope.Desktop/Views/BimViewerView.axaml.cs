using Avalonia;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Media.Imaging;
using Avalonia.Platform.Storage;
using Avalonia.Threading;
using NodeScope.Desktop.Bim;
using NodeScope.Desktop.ViewModels;

namespace NodeScope.Desktop.Views;

/// <summary>
/// Connects the renderer-only scene/camera properties to the view model. Like
/// Mapsui's Map property, these are intentionally not Avalonia binding state.
/// </summary>
internal sealed partial class BimViewerView : UserControl
{
    private BimViewerViewModel? _viewModel;
    private bool _isAttached;
    private bool _rendererReady;

    public BimViewerView()
    {
        InitializeComponent();
        Viewport.RendererReady += OnRendererReady;
        Viewport.RendererLost += OnRendererLost;
        SoftwareViewport.Picked += OnViewportPicked;
        AttachedToVisualTree += (_, _) =>
        {
            _isAttached = true;
            AttachViewModel(DataContext as BimViewerViewModel);
        };
        DetachedFromVisualTree += (_, _) =>
        {
            _isAttached = false;
            AttachViewModel(null);
        };
        DataContextChanged += (_, _) =>
        {
            if (_isAttached)
            {
                AttachViewModel(DataContext as BimViewerViewModel);
            }
        };
    }

    private void AttachViewModel(BimViewerViewModel? viewModel)
    {
        if (_viewModel is not null)
        {
            _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        }

        _viewModel = viewModel;
        Viewport.Camera = viewModel?.Camera;
        Viewport.Scene = viewModel?.Scene;
        Viewport.Options = viewModel?.RenderOptions ?? BimRenderOptions.Empty;
        SoftwareViewport.Camera = viewModel?.Camera;
        SoftwareViewport.Scene = viewModel?.Scene;
        SoftwareViewport.Options = viewModel?.RenderOptions ?? BimRenderOptions.Empty;
        SoftwareViewport.PickProductsOnly = viewModel?.PickProductsOnly ?? false;
        SoftwareViewport.RenderModel = !_rendererReady;
        if (_viewModel is not null)
        {
            _viewModel.PropertyChanged += OnViewModelPropertyChanged;
            _ = _viewModel.Initialization;
        }
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(BimViewerViewModel.Scene))
        {
            Viewport.Scene = _viewModel?.Scene;
            SoftwareViewport.Scene = _viewModel?.Scene;
        }
        else if (e.PropertyName == nameof(BimViewerViewModel.RenderOptions))
        {
            var options = _viewModel?.RenderOptions ?? BimRenderOptions.Empty;
            Viewport.Options = options;
            SoftwareViewport.Options = options;
        }
        else if (e.PropertyName == nameof(BimViewerViewModel.PickProductsOnly))
        {
            SoftwareViewport.PickProductsOnly = _viewModel?.PickProductsOnly ?? false;
        }
    }

    private void OnRendererReady(object? sender, EventArgs e) =>
        Dispatcher.UIThread.Post(() =>
        {
            _rendererReady = true;
            SoftwareViewport.RenderModel = false;
        });

    private void OnRendererLost(object? sender, EventArgs e) =>
        Dispatcher.UIThread.Post(() =>
        {
            _rendererReady = false;
            SoftwareViewport.RenderModel = true;
        });

    private async void OnViewportPicked(object? sender, BimPickResult? result)
    {
        if (_viewModel is not null)
        {
            await _viewModel.HandlePickAsync(result);
        }
    }

    private void OnToggleCategoryClick(object? sender, RoutedEventArgs e)
    {
        if (_viewModel is not null && sender is Button { Tag: BimCategoryItem category })
        {
            _viewModel.ToggleCategoryCommand.Execute(category);
        }
    }

    private void OnFlyToDeviceClick(object? sender, RoutedEventArgs e)
    {
        if (_viewModel is not null && sender is Button { Tag: BimDeviceItem device })
        {
            _viewModel.FlyToDeviceCommand.Execute(device);
        }
    }

    private async void OnCreateIssueClick(object? sender, RoutedEventArgs e)
    {
        if (_viewModel is null || SoftwareViewport.Bounds.Width < 1 || SoftwareViewport.Bounds.Height < 1)
        {
            return;
        }

        var width = Math.Clamp((int)Math.Ceiling(SoftwareViewport.Bounds.Width), 1, 4096);
        var height = Math.Clamp((int)Math.Ceiling(SoftwareViewport.Bounds.Height), 1, 4096);
        var previousRenderMode = SoftwareViewport.RenderModel;
        try
        {
            SoftwareViewport.RenderModel = true;
            using var bitmap = new RenderTargetBitmap(
                new PixelSize(width, height),
                new Vector(96, 96));
            bitmap.Render(SoftwareViewport);
            using var content = new MemoryStream();
            bitmap.Save(content, PngBitmapEncoderOptions.Default);
            await _viewModel.CreateIssueAsync(content.ToArray());
        }
        finally
        {
            SoftwareViewport.RenderModel = previousRenderMode;
        }
    }

    private async void OnImportIfcClick(object? sender, RoutedEventArgs e)
    {
        if (_viewModel is null || TopLevel.GetTopLevel(this)?.StorageProvider is not { } storage)
        {
            return;
        }

        try
        {
            var files = await storage.OpenFilePickerAsync(new FilePickerOpenOptions
            {
                Title = "Import IFC building model",
                AllowMultiple = false,
                FileTypeFilter =
                [
                    new FilePickerFileType("Industry Foundation Classes")
                    {
                        Patterns = ["*.ifc"],
                        MimeTypes = ["application/x-step", "application/octet-stream"],
                    },
                ],
            });
            if (files.Count == 0)
            {
                return;
            }

            var selected = files[0];
            var localPath = selected.TryGetLocalPath();
            if (localPath is not null)
            {
                await _viewModel.ImportFileAsync(localPath, selected.Name);
                return;
            }

            await ImportVirtualFileAsync(selected);
        }
        catch (Exception failure) when (
            failure is IOException
                or UnauthorizedAccessException
                or InvalidDataException)
        {
            _viewModel.ImportError = failure.Message;
        }
    }

    private async Task ImportVirtualFileAsync(IStorageFile selected)
    {
        var temporaryPath = Path.Combine(
            Path.GetTempPath(),
            $"nodescope-ifc-{Guid.NewGuid():N}.ifc");
        try
        {
            await using var source = await selected.OpenReadAsync();
            await using (var destination = new FileStream(
                             temporaryPath,
                             FileMode.CreateNew,
                             FileAccess.Write,
                             FileShare.None,
                             bufferSize: 81920,
                             FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                var buffer = new byte[81920];
                long total = 0;
                while (true)
                {
                    var read = await source.ReadAsync(buffer);
                    if (read == 0)
                    {
                        break;
                    }

                    total += read;
                    if (total > IfcImportLimits.MaximumBytes)
                    {
                        throw new InvalidDataException(
                            "The selected IFC exceeds the 200 MiB model limit.");
                    }

                    await destination.WriteAsync(buffer.AsMemory(0, read));
                }
            }

            await _viewModel!.ImportFileAsync(temporaryPath, selected.Name);
        }
        finally
        {
            try
            {
                File.Delete(temporaryPath);
            }
            catch (Exception failure) when (
                failure is IOException or UnauthorizedAccessException)
            {
                // Best-effort cleanup of an app-owned temporary copy.
            }
        }
    }
}
