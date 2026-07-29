using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.Extensions.Logging;
using NodeScope.Desktop.Api;
using NodeScope.Desktop.Realtime;

namespace NodeScope.Desktop.ViewModels;

/// <summary>
/// The inventory surface: equipment, circuits, and clients as tabs of one workspace
/// section (the web client spread them over three of its six bottom tabs; the desktop
/// nav rail keeps one Inventory entry).
/// </summary>
[INotifyPropertyChanged]
internal sealed partial class InventoryViewModel : IDisposable
{
    public InventoryViewModel(
        ApplianceSession session,
        IRealtimeConnection realtime,
        ILoggerFactory loggers,
        Func<BimDevice, Task>? troubleshoot = null)
    {
        Equipment = new EquipmentViewModel(
            session,
            realtime,
            loggers.CreateLogger<EquipmentViewModel>(),
            troubleshoot: troubleshoot);
        Circuits = new CircuitsViewModel(session, realtime, loggers.CreateLogger<CircuitsViewModel>());
        Clients = new ClientsViewModel(session, realtime, loggers.CreateLogger<ClientsViewModel>());
    }

    public EquipmentViewModel Equipment { get; }

    public CircuitsViewModel Circuits { get; }

    public ClientsViewModel Clients { get; }

    public void Dispose()
    {
        Equipment.Dispose();
        Circuits.Dispose();
        Clients.Dispose();
    }
}
