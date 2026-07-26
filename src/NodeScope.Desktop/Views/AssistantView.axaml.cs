using System.Collections.Specialized;
using Avalonia.Controls;
using NodeScope.Desktop.ViewModels;

namespace NodeScope.Desktop.Views;

/// <summary>The assistant chat section; keeps the transcript scrolled to the newest line.</summary>
internal sealed partial class AssistantView : UserControl
{
    public AssistantView()
    {
        InitializeComponent();
        DataContextChanged += (_, _) =>
        {
            if (DataContext is AssistantViewModel assistant)
            {
                assistant.Transcript.CollectionChanged += OnTranscriptChanged;
            }
        };
    }

    private void OnTranscriptChanged(object? sender, NotifyCollectionChangedEventArgs e) =>
        TranscriptScroll.ScrollToEnd();
}
